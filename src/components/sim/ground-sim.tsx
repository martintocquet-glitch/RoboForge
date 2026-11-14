import { Pause, Play, RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Sensor } from "@/data/types";
import type { Analysis } from "@/lib/robot-calc";
import { cn } from "@/lib/utils";
import { batteryTone, DrivePad, Telemetry, useKeyHandlers } from "./sim-controls";
import type { CameraMode, GroundLive, GroundStatic, ViewMode } from "./scene-types";
import { CAMERA_HINT, Scene3DBoundary, SceneMessage, ViewControls } from "./scene-view";
import { castRay, circleRect, distToPolyline, drawGrid, readTokens, setupCanvas, wrapAngle, type Rect, type Tokens } from "./sim-utils";

type Scenario = "arena" | "track" | "sumo";
type Tele = { label: string; value: string; tone?: "ok" | "warn" | "bad" }[];

const GroundScene3D = lazy(() => import("@/components/sim3d/ground-scene"));

const TIME_SCALE = 20; // la batterie se vide 20× plus vite pour être visible

interface Body {
  x: number;
  y: number;
  th: number;
  v: number;
  w: number;
  vs: number;
}

interface World {
  W: number;
  H: number;
  rects: Rect[];
  start: Body;
  track?: [number, number][];
  lineW?: number;
  ringR?: number;
}

const OBSTACLES: Rect[] = [
  { x: 0.2, y: 0.12, w: 0.07, h: 0.38 },
  { x: 0.42, y: 0.58, w: 0.26, h: 0.07 },
  { x: 0.6, y: 0.1, w: 0.06, h: 0.3 },
  { x: 0.82, y: 0.45, w: 0.07, h: 0.32 },
  { x: 0.33, y: 0.78, w: 0.05, h: 0.22 },
  { x: 0.45, y: 0.28, w: 0.06, h: 0.06 },
];

function walls(W: number, H: number): Rect[] {
  const t = Math.max(W, H);
  return [
    { x: -t, y: -t, w: W + 2 * t, h: t },
    { x: -t, y: H, w: W + 2 * t, h: t },
    { x: -t, y: 0, w: t, h: H },
    { x: W, y: 0, w: t, h: H },
  ];
}

function makeWorld(s: Scenario, len: number): World {
  if (s === "arena") {
    const W = Math.min(14, Math.max(3, len * 35));
    const H = W * 0.62;
    return {
      W,
      H,
      rects: [...walls(W, H), ...OBSTACLES.map((r) => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H }))],
      start: { x: W * 0.08, y: H * 0.5, th: 0, v: 0, w: 0, vs: 0 },
    };
  }
  if (s === "track") {
    const W = Math.min(8, Math.max(1.6, len * 16));
    const H = W * 0.6;
    const pts: [number, number][] = [];
    const N = 240;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      pts.push([W / 2 + W * 0.38 * Math.cos(t) + W * 0.04 * Math.cos(3 * t), H / 2 + H * 0.33 * Math.sin(t) - H * 0.12 * Math.sin(2 * t)]);
    }
    const [x0, y0] = pts[0]!;
    const [x1, y1] = pts[1]!;
    return { W, H, rects: walls(W, H), track: pts, lineW: Math.max(0.019, len * 0.15), start: { x: x0, y: y0, th: Math.atan2(y1 - y0, x1 - x0), v: 0, w: 0, vs: 0 } };
  }
  const D = len < 0.15 ? 0.77 : 1.54;
  const W = D * 1.3;
  return { W, H: W, rects: [], ringR: D / 2, start: { x: W / 2 - D * 0.25, y: W / 2, th: 0, v: 0, w: 0, vs: 0 } };
}

function rayCircle(ox: number, oy: number, a: number, cx: number, cy: number, r: number): number {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

export function GroundSim({ analysis }: { analysis: Analysis }) {
  const { type, parts } = analysis;
  const defaultScenario: Scenario = type.id === "linefollower" ? "track" : type.id === "sumo" ? "sumo" : "arena";
  const [scenario, setScenario] = useState<Scenario>(defaultScenario);
  const [auto, setAuto] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [tele, setTele] = useState<Tele>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("3d");
  const [camera, setCamera] = useState<CameraMode>("chase");
  const [st, setSt] = useState<GroundStatic | null>(null);
  const liveRef = useRef<GroundLive | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const keyHandlers = useKeyHandlers(keys);

  const distSensors = parts.sensors.filter((s) => s.kind === "distance" || s.kind === "depth" || (s.kind === "camera" && s.range));
  const lidar = parts.sensors.find((s) => s.kind === "lidar");
  const lineSensor = parts.sensors.find((s) => s.kind === "line" || s.kind === "color");
  const isMecanum = parts.propulsion?.kind === "mecanum";
  const isLeg = parts.propulsion?.kind === "leg";

  const autoReason =
    scenario === "track"
      ? lineSensor
        ? null
        : "Ajoutez un capteur de ligne (QTR-8RC, TCRT5000…) pour le suivi automatique."
      : distSensors.length || lidar
        ? null
        : "Ajoutez un capteur de distance ou un lidar pour la conduite automatique.";

  useEffect(() => {
    wrapRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const tk: Tokens = readTokens();
    const len = Math.max(0.08, (parts.chassis?.size[0] ?? 150) / 1000);
    const wid = Math.max(0.06, (parts.chassis?.size[1] ?? 120) / 1000);
    const rad = Math.hypot(len, wid) * 0.42;
    const world = makeWorld(scenario, len);
    const vmax = Math.max(0.04, analysis.speedMs);
    const wmax = Math.max(0.8, Math.min(6, (2 * vmax) / wid)) * (parts.propulsion?.kind === "track" ? 0.7 : 1);
    const accel = vmax * 3 * Math.min(1.5, Math.max(0.4, analysis.torqueMargin / 2));
    const autoOn = auto && !autoReason;

    const capAh = ((parts.battery?.capacity ?? 0) * 0.8) / 1000;
    const elecA = ((parts.controller?.currentmA ?? 0) + parts.sensors.reduce((a, s) => a + s.currentmA, 0)) / 1000;
    const motorA = Math.max(0, analysis.avgCurrentA - elecA) / 0.6;

    const me: Body = { ...world.start };
    const opp: Body = { x: world.W / 2 + (world.ringR ?? 0) * 0.5, y: world.H / 2, th: Math.PI, v: 0, w: 0, vs: 0 };
    const oppMass = Math.max(100, analysis.massG * 0.9);
    let usedAh = 0;
    let dist = 0;
    let collisions = 0;
    let touching = false;
    let simT = 0;
    let lastErr = 0;
    let turnDir = 1;
    let avoidT = 0;
    let lap = 0;
    let bestLap = Infinity;
    let lapStart = 0;
    let lastIdx = 0;
    let progress = 0;
    let offTrack = 0;
    let score = { me: 0, opp: 0 };
    let roundOver = 0;
    let gait = 0;
    let sumoPhase = 0;
    const mapCells = new Map<string, [number, number]>();
    const cell = world.W / 120;
    let lastTele = 0;
    let raf = 0;
    let prev = performance.now();
    setBanner(null);
    const sensorOffsets = distSensors.map((_, i) => (distSensors.length > 1 ? (i - (distSensors.length - 1) / 2) * 0.55 : 0));
    setSt({
      scenario,
      W: world.W,
      H: world.H,
      obstacles: world.rects.filter((r) => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= world.W + 1e-6 && r.y + r.h <= world.H + 1e-6),
      track: world.track,
      lineW: world.lineW,
      ringR: world.ringR,
      len,
      wid,
      typeId: type.id,
      propKind: parts.propulsion?.kind ?? "wheel",
      wheelD: (parts.propulsion?.diameter ?? 60) / 1000,
      wheelPairs: type.motorCount >= 4 || isMecanum ? 2 : 1,
      sensorOffsets,
      hasLidar: !!lidar,
      hasLine: !!lineSensor,
      hasCamera: parts.sensors.some((s) => s.kind === "camera"),
    });
    liveRef.current = null;

    const resetSumo = () => {
      Object.assign(me, world.start, { v: 0, w: 0, vs: 0 });
      Object.assign(opp, { x: world.W / 2 + (world.ringR ?? 0) * 0.5, y: world.H / 2, th: Math.PI, v: 0, w: 0, vs: 0 });
      roundOver = 0;
      sumoPhase = 0;
    };

    const sensorRays = (b: Body) =>
      distSensors.map((s: Sensor, i) => {
        const off = distSensors.length > 1 ? (i - (distSensors.length - 1) / 2) * 0.55 : 0;
        const a = b.th + off;
        const ox = b.x + Math.cos(b.th) * len * 0.5;
        const oy = b.y + Math.sin(b.th) * len * 0.5;
        const r = s.range ?? 2;
        const half = ((s.fov ?? 15) * Math.PI) / 360;
        let d = r;
        for (const da of [-half, 0, half]) {
          d = Math.min(d, castRay(ox, oy, a + da, r, world.rects));
          if (scenario === "sumo") d = Math.min(d, rayCircle(ox, oy, a + da, opp.x, opp.y, rad));
        }
        return { ox, oy, a, half, r, d, off };
      });

    const lidarScan = (b: Body) => {
      if (!lidar) return [];
      const n = lidar.rays ?? 72;
      const fov = ((lidar.fov ?? 360) * Math.PI) / 180;
      const r = Math.min(lidar.range ?? 8, world.W * 1.5);
      const out: { a: number; d: number; r: number }[] = [];
      for (let i = 0; i < n; i++) {
        const a = b.th - fov / 2 + (fov * (i + 0.5)) / n;
        let d = castRay(b.x, b.y, a, r, world.rects);
        if (scenario === "sumo") d = Math.min(d, rayCircle(b.x, b.y, a, opp.x, opp.y, rad));
        out.push({ a, d, r });
      }
      return out;
    };

    const lineReadings = (b: Body) => {
      if (!lineSensor || !world.track) return [] as { x: number; y: number; on: boolean; off: number }[];
      const n = Math.max(1, Math.min(15, lineSensor.rays ?? 1));
      const span = Math.max(wid * 0.7, (world.lineW ?? 0.02) * 3);
      const fx = b.x + Math.cos(b.th) * len * 0.5;
      const fy = b.y + Math.sin(b.th) * len * 0.5;
      const rx = -Math.sin(b.th);
      const ry = Math.cos(b.th);
      const out = [];
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * span;
        const x = fx + rx * off;
        const y = fy + ry * off;
        out.push({ x, y, off, on: distToPolyline(x, y, world.track) < (world.lineW ?? 0.02) / 2 });
      }
      return out;
    };

    const step = (dt: number) => {
      const k = keys.current;
      const soc = capAh > 0 ? Math.max(0, 1 - usedAh / capAh) : 0;
      const powered = soc > 0;
      let thr = 0;
      let turn = 0;
      let strafe = 0;
      const rays = sensorRays(me);
      const scan = lidarScan(me);
      const lineR = lineReadings(me);

      if (autoOn) {
        if (scenario === "track") {
          const act = lineR.filter((r) => r.on);
          const span = Math.max(1e-3, Math.abs(lineR[lineR.length - 1]?.off ?? 1e-3));
          if (act.length) lastErr = act.reduce((a, r) => a + r.off, 0) / act.length / span;
          else lastErr = Math.sign(lastErr || 1) * 1.2;
          turn = Math.max(-1, Math.min(1, lastErr * 1.6));
          thr = act.length ? 1 - 0.5 * Math.min(1, Math.abs(lastErr)) : 0.35;
        } else {
          const sector = (lo: number, hi: number) => {
            let m = Infinity;
            for (const s of scan) {
              const rel = wrapAngle(s.a - me.th);
              if (rel >= lo && rel <= hi) m = Math.min(m, s.d);
            }
            for (const r of rays) {
              if (r.off >= lo - 0.3 && r.off <= hi + 0.3) m = Math.min(m, r.d);
            }
            return m;
          };
          const front = sector(-0.45, 0.45);
          const left = sector(-1.4, -0.3);
          const right = sector(0.3, 1.4);
          if (scenario === "sumo") {
            const edge = lineR.some((r) => r.on);
            const sees = rays.some((r) => r.d < r.r * 0.98 && rayCircle(r.ox, r.oy, r.a, opp.x, opp.y, rad * 1.4) < Infinity) || scan.some((s) => s.d < s.r && rayCircle(me.x, me.y, s.a, opp.x, opp.y, rad * 1.2) < Infinity && Math.abs(wrapAngle(s.a - me.th)) < 0.5);
            if (sumoPhase > 0) {
              sumoPhase -= dt;
              thr = -0.8;
              turn = 0.8;
            } else if (edge) {
              sumoPhase = 0.5;
            } else if (sees) {
              thr = 1;
              turn = 0;
            } else {
              thr = 0.1;
              turn = 0.9;
            }
          } else {
            const safe = Math.max(0.25, len * 2.5);
            if (avoidT > 0) {
              avoidT -= dt;
              thr = 0;
              turn = turnDir;
            } else if (front < safe) {
              turnDir = left > right ? -1 : right > left ? 1 : turnDir;
              avoidT = 0.35;
              thr = 0;
              turn = turnDir;
            } else {
              thr = Math.min(1, front / (safe * 2.5));
              turn = isFinite(left) && isFinite(right) ? Math.max(-0.4, Math.min(0.4, (right - left) * 0.3)) : 0;
            }
          }
        }
      } else {
        thr = (k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0);
        turn = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
        if (isMecanum) strafe = (k.has("KeyE") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
      }
      if (!powered || (scenario === "sumo" && roundOver > 0)) {
        thr = 0;
        turn = 0;
        strafe = 0;
      }

      const sag = 0.75 + 0.25 * soc;
      const ramp = (cur: number, target: number, rate: number) => cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));
      me.v = ramp(me.v, thr * vmax * sag, accel);
      me.w = ramp(me.w, turn * wmax, wmax * 4);
      me.vs = ramp(me.vs, strafe * vmax * 0.8 * sag, accel);

      const px = me.x;
      const py = me.y;
      me.th = wrapAngle(me.th + me.w * dt);
      me.x += (Math.cos(me.th) * me.v - Math.sin(me.th) * me.vs) * dt;
      me.y += (Math.sin(me.th) * me.v + Math.cos(me.th) * me.vs) * dt;
      const hit = world.rects.some((r) => circleRect(me.x, me.y, rad, r));
      if (hit) {
        me.x = px;
        me.y = py;
        me.v = 0;
        me.vs = 0;
        if (!touching) collisions++;
      }
      touching = hit;
      dist += Math.hypot(me.x - px, me.y - py);
      gait += (Math.abs(me.v) + Math.abs(me.w) * wid) * dt * 25;

      const activity = Math.min(1, (Math.abs(me.v) + Math.abs(me.vs)) / vmax + (Math.abs(me.w) / wmax) * 0.5);
      usedAh += ((elecA + motorA * (0.15 + 0.85 * activity)) * dt * TIME_SCALE) / 3600;

      if (lidar) {
        for (const s of scan) {
          if (s.d < s.r) {
            const hx = me.x + Math.cos(s.a) * s.d;
            const hy = me.y + Math.sin(s.a) * s.d;
            const key = `${Math.floor(hx / cell)},${Math.floor(hy / cell)}`;
            if (!mapCells.has(key)) mapCells.set(key, [Math.floor(hx / cell) * cell, Math.floor(hy / cell) * cell]);
          }
        }
      }

      if (scenario === "track" && world.track) {
        const pts = world.track;
        let bi = lastIdx;
        let bd = Infinity;
        for (let j = -12; j <= 12; j++) {
          const idx = (lastIdx + j + pts.length) % pts.length;
          const d = Math.hypot(pts[idx]![0] - me.x, pts[idx]![1] - me.y);
          if (d < bd) {
            bd = d;
            bi = idx;
          }
        }
        let delta = bi - lastIdx;
        if (delta > pts.length / 2) delta -= pts.length;
        if (delta < -pts.length / 2) delta += pts.length;
        if (bd < world.W * 0.08) {
          progress += delta;
          lastIdx = bi;
        } else offTrack += dt;
        if (progress >= pts.length) {
          progress -= pts.length;
          lap++;
          bestLap = Math.min(bestLap, simT - lapStart);
          lapStart = simT;
        }
      }

      if (scenario === "sumo" && world.ringR) {
        const cx = world.W / 2;
        const cy = world.H / 2;
        if (roundOver > 0) {
          roundOver -= dt;
          if (roundOver <= 0) resetSumo();
        } else {
          // adversaire : vise le joueur, recule près du bord
          const dOpp = Math.hypot(opp.x - cx, opp.y - cy);
          const target = dOpp > world.ringR * 0.82 ? Math.atan2(cy - opp.y, cx - opp.x) : Math.atan2(me.y - opp.y, me.x - opp.x);
          const err = wrapAngle(target - opp.th);
          const ovmax = Math.min(0.8, Math.max(0.25, vmax * 0.8));
          opp.w = Math.max(-3, Math.min(3, err * 4));
          opp.v = Math.abs(err) < 0.6 ? ovmax : ovmax * 0.2;
          opp.th = wrapAngle(opp.th + opp.w * dt);
          opp.x += Math.cos(opp.th) * opp.v * dt;
          opp.y += Math.sin(opp.th) * opp.v * dt;
          const dx = opp.x - me.x;
          const dy = opp.y - me.y;
          const dd = Math.hypot(dx, dy);
          if (dd < rad * 2 && dd > 1e-6) {
            const nx = dx / dd;
            const ny = dy / dd;
            const overlap = rad * 2 - dd;
            const grip = parts.propulsion?.id === "wheel-silicone-sumo" ? 1.25 : parts.propulsion?.kind === "track" ? 1.15 : 1;
            const myF = analysis.massG * grip * (0.4 + 0.6 * Math.max(0, Math.cos(Math.atan2(ny, nx) - me.th)) * (Math.abs(me.v) > 0.01 ? Math.min(1, analysis.torqueMargin / 2) : 0.3));
            const opF = oppMass * (0.4 + 0.6 * Math.max(0, Math.cos(Math.atan2(-ny, -nx) - opp.th)) * (opp.v > 0.01 ? 1 : 0.3));
            const share = myF / (myF + opF);
            me.x -= nx * overlap * (1 - share);
            me.y -= ny * overlap * (1 - share);
            opp.x += nx * overlap * share;
            opp.y += ny * overlap * share;
          }
          const meOut = Math.hypot(me.x - cx, me.y - cy) > world.ringR;
          const oppOut = Math.hypot(opp.x - cx, opp.y - cy) > world.ringR;
          if (meOut || oppOut) {
            if (oppOut && !meOut) score = { ...score, me: score.me + 1 };
            else if (meOut && !oppOut) score = { ...score, opp: score.opp + 1 };
            setBanner(oppOut && !meOut ? "Point pour vous !" : meOut && !oppOut ? "Sorti du dohyo…" : "Égalité");
            roundOver = 1.5;
          }
        }
      }
      simT += dt;
      return { rays, scan, lineR, soc };
    };

    const draw = (s: ReturnType<typeof step>) => {
      liveRef.current = {
        me: { x: me.x, y: me.y, th: me.th, v: me.v },
        opp: scenario === "sumo" ? { x: opp.x, y: opp.y, th: opp.th, v: opp.v } : null,
        rays: s.rays,
        scan: s.scan,
        lineR: s.lineR,
        map: mapCells,
        cell,
        gait,
      };
      const canvas = canvasRef.current;
      if (!canvas || viewRef.current !== "2d") return;
      const { ctx } = setupCanvas(canvas, world.W, world.H);
      const px = world.W / 600;
      ctx.fillStyle = tk.bg;
      ctx.fillRect(0, 0, world.W, world.H);
      drawGrid(ctx, world.W, world.H, world.W > 4 ? 0.5 : world.W > 1.5 ? 0.1 : 0.05, tk.grid);

      if (world.track) {
        ctx.strokeStyle = tk.fg;
        ctx.lineWidth = world.lineW ?? 0.02;
        ctx.lineJoin = "round";
        ctx.beginPath();
        world.track.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        const [sx, sy] = world.track[0]!;
        ctx.fillStyle = tk.primary;
        ctx.fillRect(sx - px * 3, sy - (world.lineW ?? 0.02) * 2, px * 6, (world.lineW ?? 0.02) * 4);
      }
      if (world.ringR) {
        const cx = world.W / 2;
        const cy = world.H / 2;
        ctx.fillStyle = tk.panel;
        ctx.beginPath();
        ctx.arc(cx, cy, world.ringR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = tk.fg;
        ctx.lineWidth = world.ringR * 0.05;
        ctx.beginPath();
        ctx.arc(cx, cy, world.ringR * 0.975, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = tk.muted;
        ctx.lineWidth = px * 2;
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + sgn * world.ringR * 0.1, cy - world.ringR * 0.1);
          ctx.lineTo(cx + sgn * world.ringR * 0.1, cy + world.ringR * 0.1);
          ctx.stroke();
        }
      }
      ctx.fillStyle = tk.muted;
      ctx.globalAlpha = 0.35;
      for (const r of world.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tk.border;
      ctx.lineWidth = px * 1.5;
      for (const r of world.rects) ctx.strokeRect(r.x, r.y, r.w, r.h);

      // carte lidar
      if (mapCells.size) {
        ctx.fillStyle = tk.signal;
        for (const [x, y] of mapCells.values()) ctx.fillRect(x, y, cell, cell);
      }
      // rayons lidar
      ctx.strokeStyle = tk.signal;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const r of s.scan) {
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(me.x + Math.cos(r.a) * r.d, me.y + Math.sin(r.a) * r.d);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // capteurs de distance
      for (const r of s.rays) {
        ctx.fillStyle = r.d < r.r * 0.3 ? tk.danger : tk.warning;
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.moveTo(r.ox, r.oy);
        ctx.arc(r.ox, r.oy, r.d, r.a - r.half, r.a + r.half);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = px * 1.5;
        ctx.beginPath();
        ctx.moveTo(r.ox, r.oy);
        ctx.lineTo(r.ox + Math.cos(r.a) * r.d, r.oy + Math.sin(r.a) * r.d);
        ctx.stroke();
      }

      const drawBot = (b: Body, color: string, mine: boolean) => {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.th);
        const kind = mine ? parts.propulsion?.kind : "wheel";
        ctx.fillStyle = tk.fg;
        ctx.globalAlpha = 0.85;
        if (kind === "track") {
          ctx.fillRect(-len / 2, -wid / 2 - wid * 0.08, len, wid * 0.22);
          ctx.fillRect(-len / 2, wid / 2 - wid * 0.14, len, wid * 0.22);
        } else if (kind === "leg") {
          ctx.strokeStyle = tk.fg;
          ctx.lineWidth = wid * 0.07;
          const pairs = type.id === "hexapod" ? 3 : 1;
          for (let i = 0; i < pairs; i++) {
            const lx = pairs === 1 ? 0 : (i - 1) * len * 0.38;
            for (const side of [-1, 1]) {
              const ph = Math.sin(gait + i * 2 + (side > 0 ? Math.PI : 0)) * len * 0.12;
              ctx.beginPath();
              ctx.moveTo(lx, side * wid * 0.3);
              ctx.lineTo(lx + ph, side * wid * (pairs === 1 ? 0.55 : 0.85));
              ctx.stroke();
            }
          }
        } else {
          const n = mine && (type.motorCount >= 4 || isMecanum) ? 2 : 1;
          const ww = Math.max(len * 0.25, (parts.propulsion?.diameter ?? 60) / 1000);
          for (let i = 0; i < n; i++) {
            const wx = n === 1 ? 0 : (i ? 1 : -1) * len * 0.3;
            ctx.fillRect(wx - ww / 2, -wid / 2 - wid * 0.06, ww, wid * 0.16);
            ctx.fillRect(wx - ww / 2, wid / 2 - wid * 0.1, ww, wid * 0.16);
          }
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = tk.panel;
        ctx.strokeStyle = color;
        ctx.lineWidth = px * 2.5;
        ctx.beginPath();
        ctx.roundRect(-len / 2, -wid * 0.4, len, wid * 0.8, len * 0.12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(len * 0.42, 0);
        ctx.lineTo(len * 0.12, -wid * 0.18);
        ctx.lineTo(len * 0.12, wid * 0.18);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      if (scenario === "sumo") drawBot(opp, tk.danger, false);
      drawBot(me, tk.primary, true);

      for (const r of s.lineR) {
        ctx.fillStyle = r.on ? tk.success : tk.muted;
        ctx.beginPath();
        ctx.arc(r.x, r.y, Math.max(px * 2.5, wid * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (now: number) => {
      const real = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      let s = null as ReturnType<typeof step> | null;
      if (!pausedRef.current) {
        const sub = 4;
        for (let i = 0; i < sub; i++) s = step(real / sub);
      } else s = { rays: sensorRays(me), scan: lidarScan(me), lineR: lineReadings(me), soc: capAh > 0 ? Math.max(0, 1 - usedAh / capAh) : 0 };
      draw(s!);
      if (now - lastTele > 120) {
        lastTele = now;
        const soc = s!.soc;
        const remain = analysis.autonomyMin * soc;
        const items: Tele = [
          { label: "Vitesse", value: `${Math.abs(me.v).toFixed(2)} m/s` },
          { label: "Batterie", value: `${Math.round(soc * 100)} %`, tone: batteryTone(soc * 100) },
          { label: "Autonomie restante", value: remain > 60 ? `${Math.floor(remain / 60)} h ${String(Math.round(remain % 60)).padStart(2, "0")}` : `${Math.round(remain)} min` },
          { label: "Distance", value: `${dist.toFixed(1)} m` },
        ];
        if (scenario === "arena") {
          items.push({ label: "Collisions", value: String(collisions), tone: collisions ? "warn" : "ok" });
          if (s!.rays.length) items.push({ label: "Obstacle devant", value: `${Math.min(...s!.rays.map((r) => r.d)).toFixed(2)} m` });
          if (lidar) items.push({ label: "Points cartographiés", value: String(mapCells.size) });
        } else if (scenario === "track") {
          items.push({ label: "Tours", value: String(lap) });
          items.push({ label: "Meilleur tour", value: isFinite(bestLap) ? `${bestLap.toFixed(1)} s` : "—" });
          items.push({ label: "Hors piste", value: `${offTrack.toFixed(1)} s`, tone: offTrack > 1 ? "warn" : "ok" });
          if (s!.lineR.length) items.push({ label: "Capteurs sur la ligne", value: `${s!.lineR.filter((r) => r.on).length} / ${s!.lineR.length}` });
        } else {
          items.push({ label: "Score", value: `${score.me} – ${score.opp}`, tone: score.me >= score.opp ? "ok" : "bad" });
          items.push({ label: "Masse adversaire", value: `${Math.round(oppMass)} g` });
        }
        if (soc <= 0) items.push({ label: "État", value: "Batterie vide", tone: "bad" });
        setTele(items);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => {
      if (canvasRef.current) setupCanvas(canvasRef.current, world.W, world.H);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, auto, resetKey, analysis]);

  const scenarios: [Scenario, string][] = [
    ["arena", "Arène d'obstacles"],
    ["track", "Piste de suivi de ligne"],
    ["sumo", "Combat de sumo"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {scenarios.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setScenario(id)}
            className={cn("rounded-full border px-3 py-1 text-sm transition-colors", scenario === id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label className={cn("flex items-center gap-2 text-sm", autoReason && "opacity-50")}>
            <Switch checked={auto && !autoReason} disabled={!!autoReason} onCheckedChange={setAuto} />
            {scenario === "track" ? "Suivi automatique" : scenario === "sumo" ? "Combat automatique" : "Évitement automatique"}
          </label>
          <Button size="sm" variant="secondary" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Reprendre" : "Pause"}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setResetKey((k) => k + 1)} aria-label="Recommencer">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewControls view={view} setView={setView} camera={camera} setCamera={setCamera} />
        {autoReason && <p className="text-sm text-warning">{autoReason}</p>}
      </div>

      <div
        ref={wrapRef}
        {...keyHandlers}
        data-scene-root={view === "3d" ? "" : undefined}
        className={cn("relative overflow-hidden rounded-md border border-border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring", view === "3d" && "h-[min(70vh,560px)] min-h-[320px]")}
        onPointerDown={() => wrapRef.current?.focus({ preventScroll: true })}
      >
        {view === "2d" ? (
          <canvas ref={canvasRef} className="block w-full" />
        ) : st ? (
          <Scene3DBoundary
            fallback={
              <SceneMessage>
                La vue 3D ne fonctionne pas sur cet appareil.{" "}
                <button type="button" className="ml-1 text-primary underline" onClick={() => setView("2d")}>
                  Passer en 2D
                </button>
              </SceneMessage>
            }
          >
            <Suspense fallback={<SceneMessage>Chargement du monde 3D…</SceneMessage>}>
              <GroundScene3D st={st} live={liveRef} camera={camera} />
            </Suspense>
          </Scene3DBoundary>
        ) : (
          <SceneMessage>Chargement du monde 3D…</SceneMessage>
        )}
        {banner && scenario === "sumo" && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded bg-card px-3 py-1 font-display text-sm font-semibold shadow-panel">{banner}</div>
        )}
        <div className="pointer-events-none absolute bottom-2 left-2 label-tech">
          {view === "3d" ? CAMERA_HINT[camera] : isLeg ? "Démarche simplifiée vue de dessus" : "Vue de dessus"} · batterie accélérée ×{TIME_SCALE}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-md text-sm text-muted-foreground">
          Cliquez sur la zone de jeu puis pilotez avec les flèches{isMecanum ? ", et A/E (ou Q/D) pour glisser de côté" : ""}. Vous pouvez aussi utiliser les boutons.
        </p>
        <DrivePad keys={keys} strafe={isMecanum} />
      </div>
      <Telemetry items={tele} />
    </div>
  );
}
