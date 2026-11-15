import { RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { armGeom, canLift, clampJoint, tipPos, type Joints } from "@/lib/arm-kinematics";
import type { Analysis } from "@/lib/robot-calc";
import { cn } from "@/lib/utils";
import { Telemetry, useKeyHandlers, type KeySet } from "./sim-controls";
import type { ArmLive, ArmObject, ArmStatic, CameraMode, ViewMode } from "./scene-types";
import { Scene3DBoundary, SceneMessage, ViewControls } from "./scene-view";
import { readTokens, setupCanvas, withAlpha } from "./sim-utils";

type Tele = { label: string; value: string; tone?: "ok" | "warn" | "bad" | undefined }[];

const ArmScene3D = lazy(() => import("@/components/sim3d/arm-scene"));

const OBJECTS: { a: number; r: number; massG: number }[] = [
  { a: -0.9, r: 0.55, massG: 20 },
  { a: -0.4, r: 0.75, massG: 60 },
  { a: 0.15, r: 0.6, massG: 150 },
  { a: 0.6, r: 0.8, massG: 400 },
  { a: 1.1, r: 0.5, massG: 1200 },
];

function makeWorld(reach: number, suction: boolean) {
  const g = armGeom(reach);
  const W = reach * 2.6;
  const H = reach * 2.6;
  const base = { x: W / 2, y: H / 2 };
  const size = reach * 0.11;
  const st: ArmStatic = {
    W, H, base, ...g, suction,
    bin: { x: base.x - reach * 0.85, y: base.y + reach * 0.35, w: reach * 0.4, h: reach * 0.4, depth: reach * 0.12 },
  };
  const objects: ArmObject[] = OBJECTS.map((o, i) => ({
    id: i, x: base.x + Math.cos(o.a) * reach * o.r, y: base.y + Math.sin(o.a) * reach * o.r,
    z: 0, size, massG: o.massG, held: false, done: false,
  }));
  return { st, objects };
}

function inBin(st: ArmStatic, x: number, y: number) {
  const b = st.bin;
  return x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
}

export function ArmSim({ analysis }: { analysis: Analysis }) {
  const [view, setView] = useState<ViewMode>("3d");
  const [camera, setCamera] = useState<CameraMode>("orbit");
  const [st, setSt] = useState<ArmStatic | null>(null);
  const [tele, setTele] = useState<Tele>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const liveRef = useRef<ArmLive | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const keyHandlers = useKeyHandlers(keys);

  const { parts } = analysis;
  const reach = (parts.chassis?.reach ?? 300) / 1000;
  const payloadG = analysis.payloadG;
  const speed = Math.min(220, Math.max(20, analysis.armSpeedDegS || 90)) * (Math.PI / 180) * 0.5;
  const suction = parts.propulsion?.id === "suction-cup";
  const force = parts.sensors.find((s) => s.kind === "force");

  useEffect(() => {
    const { st: s, objects } = makeWorld(reach, suction);
    const g = { baseH: s.baseH, L1: s.L1, L2: s.L2, tool: s.tool };
    const j: Joints = { q0: 0, q1: 1.1, q2: -1.6 };
    const L: ArmLive = { ...j, grip: 0, tip: { x: 0, y: 0, z: 0 }, objects };
    liveRef.current = L;
    setSt(s);
    setMsg(null);
    let closed = false;
    let spaceWas = false;
    let held: ArmObject | null = null;
    let raf = 0;
    let last = performance.now();
    let teleT = 0;
    let gripN = 0;
    const tk = readTokens();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = keys.current;
      const prev = { q0: L.q0, q1: L.q1, q2: L.q2 };
      if (k.has("ArrowLeft")) L.q0 = clampJoint("q0", L.q0 + speed * dt);
      if (k.has("ArrowRight")) L.q0 = clampJoint("q0", L.q0 - speed * dt);
      if (k.has("ArrowUp")) L.q1 = clampJoint("q1", L.q1 + speed * dt);
      if (k.has("ArrowDown")) L.q1 = clampJoint("q1", L.q1 - speed * dt);
      if (k.has("KeyE")) L.q2 = clampJoint("q2", L.q2 + speed * dt);
      if (k.has("KeyA")) L.q2 = clampJoint("q2", L.q2 - speed * dt);
      let p = tipPos(g, L);
      // La pince ne traverse pas la table ni l'objet qu'elle porte.
      const floor = held ? held.size : 0;
      if (p.z < floor || p.r < s.L1 * 0.25) {
        L.q0 = prev.q0; L.q1 = prev.q1; L.q2 = prev.q2;
        p = tipPos(g, L);
      }
      L.tip = { x: s.base.x + p.x, y: s.base.y + p.y, z: p.z };

      const space = k.has("Space");
      if (space && !spaceWas) {
        closed = !closed;
        if (closed) {
          const near = L.objects.find(
            (o) => !o.done && Math.hypot(o.x - L.tip.x, o.y - L.tip.y) < o.size * 0.7 && Math.abs(L.tip.z - (o.z + o.size)) < o.size * 0.6,
          );
          if (near) {
            if (canLift(near.massG, payloadG)) {
              held = near; near.held = true;
              setMsg(`Objet de ${near.massG} g saisi.`);
            } else {
              setMsg(`Trop lourd : ${near.massG} g pour une charge utile de ${Math.round(payloadG)} g. Le moteur de l'épaule cale.`);
            }
            gripN = (near.massG / 1000) * 9.81 * 2.5;
          } else gripN = 0;
        } else if (held) {
          const o = held;
          o.held = false; held = null; gripN = 0;
          if (inBin(s, o.x, o.y)) {
            o.done = true; o.z = 0;
            setMsg(`Objet de ${o.massG} g déposé dans le bac.`);
          } else setMsg("Objet relâché.");
        }
      }
      spaceWas = space;
      L.grip += ((closed ? (held ? 0.6 : 1) : 0) - L.grip) * Math.min(1, dt * 10);
      if (held) {
        held.x = L.tip.x; held.y = L.tip.y; held.z = L.tip.z - held.size;
      }
      // Gravité sur les objets relâchés
      for (const o of L.objects) if (!o.held && o.z > 0) o.z = Math.max(0, o.z - 1.5 * dt);

      if (viewRef.current === "2d" && canvasRef.current) draw2d(canvasRef.current, s, L, tk);

      teleT -= dt;
      if (teleT <= 0) {
        teleT = 0.2;
        const done = L.objects.filter((o) => o.done).length;
        const deg = (r: number) => `${Math.round((r * 180) / Math.PI)}°`;
        setTele([
          { label: "Base", value: deg(L.q0) },
          { label: "Épaule", value: deg(L.q1) },
          { label: "Coude", value: deg(L.q2) },
          { label: "Hauteur pince", value: `${(L.tip.z * 100).toFixed(1)} cm` },
          { label: "Pince", value: held ? "Objet tenu" : closed ? "Fermée" : "Ouverte", ...(held ? { tone: "ok" as const } : {}) },
          { label: "Charge utile", value: `${Math.round(payloadG)} g` },
          { label: "Force de serrage", value: force ? `${gripN.toFixed(1)} N` : "Pas de capteur de force", tone: force ? "ok" : "warn" },
          { label: "Dans le bac", value: `${done} / ${L.objects.length}`, ...(done === L.objects.length ? { tone: "ok" as const } : {}) },
        ]);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reach, suction, payloadG, speed, force, resetKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewControls view={view} setView={setView} camera={camera} setCamera={setCamera} />
        <Button variant="secondary" size="sm" onClick={() => setResetKey((k) => k + 1)}>
          <RotateCcw className="mr-1 h-4 w-4" /> Recommencer
        </Button>
      </div>
      <div
        ref={wrapRef}
        {...keyHandlers}
        data-scene-root={view === "3d" ? "" : undefined}
        className={cn("relative overflow-hidden rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring", view === "3d" && "h-[min(70vh,560px)] min-h-[320px]")}
        onPointerDown={() => wrapRef.current?.focus({ preventScroll: true })}
      >
        {view === "2d" ? (
          <canvas ref={canvasRef} className="block w-full" />
        ) : st ? (
          <Scene3DBoundary fallback={<SceneMessage>La vue 3D ne fonctionne pas sur cet appareil.</SceneMessage>}>
            <Suspense fallback={<SceneMessage>Chargement du plan de travail 3D…</SceneMessage>}>
              <ArmScene3D st={st} live={liveRef} camera={camera} />
            </Suspense>
          </Scene3DBoundary>
        ) : (
          <SceneMessage>Chargement du plan de travail 3D…</SceneMessage>
        )}
        {msg && <div className="pointer-events-none absolute left-2 top-2 rounded bg-panel/90 px-2 py-1 text-xs">{msg}</div>}
      </div>
      <Telemetry items={tele} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <Pair keys={keys} label="Base" a="ArrowLeft" b="ArrowRight" ta="◀" tb="▶" />
          <Pair keys={keys} label="Épaule" a="ArrowUp" b="ArrowDown" ta="▲" tb="▼" />
          <Pair keys={keys} label="Coude" a="KeyE" b="KeyA" ta="▲" tb="▼" />
          <div className="flex flex-col items-center gap-1">
            <span className="label-tech">{suction ? "Ventouse" : "Pince"}</span>
            <Hold keys={keys} k="Space">Saisir / lâcher</Hold>
          </div>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          Flèches gauche/droite : tourner la base · haut/bas : épaule · A/E : coude · Espace : saisir ou lâcher.
          Posez la pince sur un cube, saisissez-le et lâchez-le au-dessus du bac. Les cubes trop lourds pour vos moteurs ne se soulèvent pas.
        </p>
      </div>
    </div>
  );
}

function Hold({ keys, k, children }: { keys: KeySet; k: string; children: ReactNode }) {
  const up = () => keys.current.delete(k);
  return (
    <button
      type="button"
      onPointerDown={() => keys.current.add(k)}
      onPointerUp={up}
      onPointerLeave={up}
      className="h-11 min-w-11 select-none rounded-md border border-border bg-secondary px-3 text-sm text-secondary-foreground active:bg-primary active:text-primary-foreground"
    >
      {children}
    </button>
  );
}

function Pair({ keys, label, a, b, ta, tb }: { keys: KeySet; label: string; a: string; b: string; ta: string; tb: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="label-tech">{label}</span>
      <div className="flex gap-1">
        <Hold keys={keys} k={a}>{ta}</Hold>
        <Hold keys={keys} k={b}>{tb}</Hold>
      </div>
    </div>
  );
}

function draw2d(canvas: HTMLCanvasElement, st: ArmStatic, L: ArmLive, tk: ReturnType<typeof readTokens>) {
  const { ctx } = setupCanvas(canvas, st.W, st.H);
  ctx.fillStyle = tk.bg;
  ctx.fillRect(0, 0, st.W, st.H);
  ctx.strokeStyle = withAlpha(tk.muted, 0.4);
  ctx.lineWidth = st.W / 300;
  ctx.beginPath();
  ctx.arc(st.base.x, st.base.y, st.L1 + st.L2, 0, Math.PI * 2);
  ctx.stroke();
  const b = st.bin;
  ctx.fillStyle = withAlpha(tk.success, 0.25);
  ctx.fillRect(b.x, b.y, b.w, b.h);
  for (const o of L.objects) {
    ctx.fillStyle = o.done ? tk.success : o.held ? tk.primary : tk.signal;
    ctx.fillRect(o.x - o.size / 2, o.y - o.size / 2, o.size, o.size);
  }
  ctx.strokeStyle = tk.primary;
  ctx.lineWidth = st.W / 60;
  ctx.lineCap = "round";
  const e = { x: st.base.x + Math.cos(L.q0) * st.L1 * Math.cos(L.q1), y: st.base.y + Math.sin(L.q0) * st.L1 * Math.cos(L.q1) };
  ctx.beginPath();
  ctx.moveTo(st.base.x, st.base.y);
  ctx.lineTo(e.x, e.y);
  ctx.lineTo(L.tip.x, L.tip.y);
  ctx.stroke();
  ctx.fillStyle = tk.fg;
  ctx.beginPath();
  ctx.arc(L.tip.x, L.tip.y, st.W / 80, 0, Math.PI * 2);
  ctx.fill();
}
