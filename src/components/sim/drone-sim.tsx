import { Pause, Play, RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Analysis } from "@/lib/robot-calc";
import { GRAVITY } from "@/lib/robot-calc";
import { cn } from "@/lib/utils";
import { capabilities, gpsOffset } from "@/lib/sensor-effects";
import { batteryTone, DrivePad, Telemetry, useKeyHandlers } from "./sim-controls";
import type { CameraMode, DroneLive, DroneStatic, ViewMode } from "./scene-types";
import { CAMERA_HINT, Scene3DBoundary, SceneMessage, ViewControls } from "./scene-view";
import { castRay, circleRect, drawGrid, readTokens, setupCanvas, withAlpha, type Rect, type Tokens } from "./sim-utils";

type Tele = { label: string; value: string; tone?: "ok" | "warn" | "bad" }[];

const DroneScene3D = lazy(() => import("@/components/sim3d/drone-scene"));

const TIME_SCALE = 20; // la batterie se vide 20× plus vite pour être visible
const CEILING = 12; // m

interface Building extends Rect {
  alt: number; // hauteur en m
}

interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
}

// Obstacles : bâtiments de hauteurs variées (coordonnées relatives à l'arène, alt = hauteur en m)
const BUILDINGS: { x: number; y: number; w: number; rh: number; alt: number }[] = [
  { x: 0.18, y: 0.1, w: 0.1, rh: 0.28, alt: 3 },
  { x: 0.42, y: 0.55, w: 0.16, rh: 0.12, alt: 6 },
  { x: 0.62, y: 0.12, w: 0.08, rh: 0.3, alt: 2 },
  { x: 0.8, y: 0.5, w: 0.1, rh: 0.3, alt: 8 },
  { x: 0.3, y: 0.75, w: 0.08, rh: 0.18, alt: 4.5 },
  { x: 0.08, y: 0.55, w: 0.07, rh: 0.15, alt: 1.2 },
];

export function DroneSim({ analysis }: { analysis: Analysis }) {
  const [auto, setAuto] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [tele, setTele] = useState<Tele>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("3d");
  const [camera, setCamera] = useState<CameraMode>("chase");
  const [st, setSt] = useState<DroneStatic | null>(null);
  const liveRef = useRef<DroneLive | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const keyHandlers = useKeyHandlers(keys);

  const { parts } = analysis;
  const distSensors = parts.sensors.filter((s) => s.kind === "distance" || s.kind === "depth" || (s.kind === "camera" && s.range));
  const lidar = parts.sensors.find((s) => s.kind === "lidar");
  const gps = parts.sensors.find((s) => s.kind === "gps");
  const imu = parts.sensors.find((s) => s.kind === "imu" || s.kind === "compass");

  const autoReason = !gps
    ? "Ajoutez un GPS (NEO-M8N, ZED-F9P…) pour le vol automatique par waypoints."
    : null;

  useEffect(() => {
    wrapRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const tk: Tokens = readTokens();

    const span = Math.max(0.2, ((parts.chassis?.size[0] ?? 450) + (parts.propulsion?.diameter ?? 10) * 25.4) / 1000);
    const rad = span / 2;
    const W = Math.min(30, Math.max(12, span * 30));
    const H = W * 0.62;
    const buildings: Building[] = BUILDINGS.map((b) => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.rh * H, alt: b.alt }));

    // Physique dérivée des vraies caractéristiques
    const tw = Math.max(1.01, analysis.thrustRatio);
    const hoverThr = 1 / tw;
    const maxClimbA = GRAVITY * (tw - 1); // accélération verticale max
    const vmax = Math.max(2, analysis.speedMs); // vitesse horizontale max
    const tiltA = vmax * 2.5; // accélération horizontale
    const autoOn = auto && !autoReason;
    const caps = capabilities(parts.sensors);
    let fix: { x: number; y: number } | null = null;
    let fixT = 0;

    const capAh = ((parts.battery?.capacity ?? 0) * 0.8) / 1000;
    const elecA = ((parts.controller?.currentmA ?? 0) + parts.sensors.reduce((a, s) => a + s.currentmA, 0)) / 1000;
    const motorHoverA = Math.max(0, analysis.avgCurrentA - elecA);

    const start: Body = { x: W * 0.08, y: H * 0.85, z: 0, vx: 0, vy: 0, vz: 0, yaw: -Math.PI / 2 };
    const me: Body = { ...start };
    let usedAh = 0;
    let dist = 0;
    let maxAlt = 0;
    let simT = 0;
    let crashed: string | null = null;
    let throttle = 0; // 0..1 poussée totale
    let waypoint: [number, number] | null = null;
    let wpCount = 0;
    let wpWait = 0;
    let lastTele = 0;
    let raf = 0;
    let prev = performance.now();
    setBanner(null);
    setSt({
      W,
      H,
      ceiling: CEILING,
      buildings,
      span,
      motorCount: analysis.type.motorCount,
      hasGps: !!gps,
      hasLidar: !!lidar,
      gpsAcc: caps.gpsAcc,
      start: { x: start.x, y: start.y },
    });
    liveRef.current = null;

    const newWaypoint = (): [number, number] => {
      // waypoint au hasard, à distance raisonnable, pas dans un bâtiment haut
      for (let tries = 0; tries < 40; tries++) {
        const x = W * (0.08 + Math.random() * 0.84);
        const y = H * (0.08 + Math.random() * 0.84);
        if (Math.hypot(x - me.x, y - me.y) < W * 0.2) continue;
        if (buildings.some((b) => b.alt > 7 && circleRect(x, y, rad * 2, b))) continue;
        return [x, y];
      }
      return [W * 0.5, H * 0.5];
    };

    const sensorRays = () =>
      distSensors.map((s, i) => {
        const off = distSensors.length > 1 ? (i - (distSensors.length - 1) / 2) * 0.8 : 0;
        const a = me.yaw + off;
        const r = s.range ?? 4;
        let d = r;
        for (const b of buildings) {
          if (me.z < b.alt) d = Math.min(d, castRay(me.x, me.y, a, r, [b]));
        }
        // murs de l'arène
        d = Math.min(d, me.x, me.y, W - me.x, H - me.y);
        return { a, r, d, off };
      });

    const lidarScan = () => {
      if (!lidar) return [];
      const n = Math.min(lidar.rays ?? 72, 90);
      const fov = ((lidar.fov ?? 360) * Math.PI) / 180;
      const r = Math.min(lidar.range ?? 8, W);
      const out: { a: number; d: number; r: number }[] = [];
      const low = buildings.filter((b) => me.z < b.alt);
      for (let i = 0; i < n; i++) {
        const a = me.yaw - fov / 2 + (fov * (i + 0.5)) / n;
        out.push({ a, d: castRay(me.x, me.y, a, r, low), r });
      }
      return out;
    };

    const step = (dt: number) => {
      const k = keys.current;
      const soc = capAh > 0 ? Math.max(0, 1 - usedAh / capAh) : 0;
      const powered = soc > 0 && !crashed;
      let cmdX = 0; // avant/arrière
      let cmdY = 0; // latéral
      let cmdZ = 0; // vertical
      let cmdYaw = 0;
      const rays = sensorRays();
      const scan = lidarScan();

      // le point GPS est rafraîchi 5 fois par seconde, avec l'erreur de l'antenne montée
      fixT += dt;
      if (caps.gpsAcc != null && fixT >= 0.2) {
        fixT = 0;
        const [ox, oy] = gpsOffset(caps.gpsAcc);
        fix = { x: me.x + ox, y: me.y + oy };
      }

      if (autoOn) {
        // Mission : enchaîner des waypoints en maintenant une altitude de croisière
        const cruise = 5;
        if (!waypoint) waypoint = newWaypoint();
        // le drone se dirige d'après la position que son GPS lui renvoie
        const fxX = fix ? fix.x : me.x;
        const fxY = fix ? fix.y : me.y;
        const dx = waypoint[0] - fxX;
        const dy = waypoint[1] - fxY;
        const d = Math.hypot(dx, dy);
        // l'arrivée, elle, est jugée sur la position réelle
        if (Math.hypot(waypoint[0] - me.x, waypoint[1] - me.y) < Math.max(0.6, span)) {
          wpWait += dt;
          if (wpWait > 0.8) {
            waypoint = null;
            wpWait = 0;
            wpCount++;
          }
        } else {
          const target = Math.atan2(dy, dx);
          const yawErr = Math.atan2(Math.sin(target - me.yaw), Math.cos(target - me.yaw));
          cmdYaw = Math.max(-1, Math.min(1, yawErr * 2));
          const facing = Math.cos(yawErr);
          // vitesse de croisière limitée pour laisser le temps de monter
          const cruiseSpd = Math.min(1, 5 / vmax);
          cmdX = Math.max(0, Math.min(cruiseSpd, d / 4)) * Math.max(0.15, facing);
        }
        // maintien d'altitude + survol des obstacles détectés sur la trajectoire
        let targetAlt = cruise;
        const speed = Math.hypot(me.vx, me.vy);
        const look = Math.max(3, speed * 2);
        const dirX = speed > 0.5 ? me.vx / speed : Math.cos(me.yaw);
        const dirY = speed > 0.5 ? me.vy / speed : Math.sin(me.yaw);
        for (const b of buildings) {
          // position actuelle (marge élargie) : un obstacle plus haut impose de monter
          if (b.alt > targetAlt - 1 && circleRect(me.x, me.y, rad * 2.5, b)) targetAlt = b.alt + 1.5;
          for (const t of [0.25, 0.5, 0.75, 1]) {
            const aheadX = me.x + dirX * look * t;
            const aheadY = me.y + dirY * look * t;
            if (circleRect(aheadX, aheadY, rad * 2, b) && b.alt > targetAlt - 1) targetAlt = b.alt + 1.5;
          }
        }
        // ralentir tant que l'altitude de survol n'est pas atteinte
        if (targetAlt > cruise && me.z < targetAlt - 1) cmdX = Math.min(cmdX, 0.25);
        if (imu) targetAlt = Math.min(CEILING - 1, targetAlt);
        cmdZ = Math.max(-1, Math.min(1, (targetAlt - me.z) * 0.8 - me.vz * 0.5));
      } else {
        cmdX = (k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0);
        cmdYaw = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
        cmdZ = (k.has("Space") ? 1 : 0) - (k.has("KeyC") ? 1 : 0);
        if (k.has("KeyA")) cmdY = -1;
        if (k.has("KeyE")) cmdY = 1;
      }
      if (!powered) {
        cmdX = 0;
        cmdY = 0;
        cmdZ = 0;
        cmdYaw = 0;
      }

      // La poussée suit la commande verticale autour du point de stationnaire
      const targetThr = crashed || soc <= 0 ? 0 : Math.max(0, Math.min(1, hoverThr + cmdZ * (1 - hoverThr) * 0.9));
      throttle += Math.max(-2.5 * dt, Math.min(2.5 * dt, targetThr - throttle));

      // Dynamique verticale
      const az = GRAVITY * (tw * throttle - 1);
      me.vz += az * dt;
      me.vz = Math.max(-8, Math.min(8, me.vz));
      me.z += me.vz * dt;
      if (me.z <= 0) {
        if (me.vz < -3 && !crashed) {
          crashed = "Atterrissage trop brutal : le drone s'écrase.";
          setBanner(crashed);
        }
        me.z = 0;
        me.vz = 0;
      }
      if (me.z >= CEILING) {
        me.z = CEILING;
        me.vz = Math.min(0, me.vz);
      }
      maxAlt = Math.max(maxAlt, me.z);

      // Dynamique horizontale (le tilt suit les commandes)
      const sag = 0.8 + 0.2 * soc;
      const flying = me.z > 0.02;
      const axBody = cmdX * tiltA * sag;
      const ayBody = cmdY * tiltA * 0.8 * sag;
      const cos = Math.cos(me.yaw);
      const sin = Math.sin(me.yaw);
      if (flying) {
        me.vx += (cos * axBody - sin * ayBody) * dt;
        me.vy += (sin * axBody + cos * ayBody) * dt;
        // traînée
        const drag = Math.pow(0.5, dt / 0.8);
        me.vx *= drag;
        me.vy *= drag;
        const sp = Math.hypot(me.vx, me.vy);
        if (sp > vmax) {
          me.vx = (me.vx / sp) * vmax;
          me.vy = (me.vy / sp) * vmax;
        }
      } else {
        me.vx = 0;
        me.vy = 0;
      }
      me.yaw += cmdYaw * 2.2 * dt;

      const px = me.x;
      const py = me.y;
      me.x += me.vx * dt;
      me.y += me.vy * dt;

      // collisions avec les bâtiments (seulement sous leur hauteur)
      const hit = buildings.find((b) => me.z < b.alt && circleRect(me.x, me.y, rad, b));
      if (hit && !crashed) {
        const speed = Math.hypot(me.vx, me.vy);
        if (speed > 1.5 || me.vz < -1) {
          crashed = `Collision avec un obstacle de ${hit.alt} m à ${speed.toFixed(1)} m/s.`;
          setBanner(crashed);
        }
        me.x = px;
        me.y = py;
        me.vx = 0;
        me.vy = 0;
      }
      // limites de l'arène
      if (me.x < rad || me.x > W - rad || me.y < rad || me.y > H - rad) {
        me.x = Math.max(rad, Math.min(W - rad, me.x));
        me.y = Math.max(rad, Math.min(H - rad, me.y));
        me.vx = 0;
        me.vy = 0;
      }
      dist += Math.hypot(me.x - px, me.y - py);

      // consommation : poussée^1.5 comme dans l'analyse
      const motorA = motorHoverA * Math.pow(throttle / Math.max(0.05, hoverThr), 1.5) * hoverThr;
      usedAh += ((elecA + motorA) * dt * TIME_SCALE) / 3600;
      if (soc <= 0 && !crashed && me.z > 0) {
        crashed = "Batterie vide : le drone tombe.";
        setBanner(crashed);
      }

      simT += dt;
      return { rays, scan, soc };
    };

    const draw = (s: ReturnType<typeof step>) => {
      liveRef.current = {
        me: { ...me },
        throttle,
        rays: s.rays,
        scan: s.scan,
        waypoint: autoOn ? waypoint : null,
        crashed: !!crashed,
        fix,
      };
      const canvas = canvasRef.current;
      if (!canvas || viewRef.current !== "2d") return;
      const { ctx } = setupCanvas(canvas, W, H);
      const px = W / 600;
      ctx.fillStyle = tk.bg;
      ctx.fillRect(0, 0, W, H);
      drawGrid(ctx, W, H, 1, tk.grid);

      // bâtiments, teintés selon la hauteur
      for (const b of buildings) {
        const t = Math.min(1, b.alt / CEILING);
        ctx.fillStyle = withAlpha(tk.muted, 0.25 + t * 0.55);
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = tk.border;
        ctx.lineWidth = px * 1.5;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        // étiquette de hauteur
        ctx.fillStyle = tk.fg;
        ctx.font = `${px * 11}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`${b.alt} m`, b.x + b.w / 2, b.y + b.h / 2 + px * 4);
        // contour danger si le drone est sous la hauteur du bâtiment
        if (me.z < b.alt) {
          ctx.strokeStyle = withAlpha(tk.danger, 0.5);
          ctx.lineWidth = px * 2;
          ctx.strokeRect(b.x - px * 2, b.y - px * 2, b.w + px * 4, b.h + px * 4);
        }
      }

      // waypoint courant
      if (waypoint && autoOn) {
        ctx.strokeStyle = tk.primary;
        ctx.lineWidth = px * 2;
        ctx.setLineDash([px * 6, px * 4]);
        ctx.beginPath();
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(waypoint[0], waypoint[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(waypoint[0], waypoint[1], px * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // rayons capteurs
      for (const r of s.rays) {
        ctx.strokeStyle = r.d < r.r * 0.3 ? tk.danger : tk.warning;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = px * 1.5;
        ctx.beginPath();
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(me.x + Math.cos(r.a) * r.d, me.y + Math.sin(r.a) * r.d);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = tk.signal;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const r of s.scan) {
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(me.x + Math.cos(r.a) * r.d, me.y + Math.sin(r.a) * r.d);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // ombre au sol (décalée selon l'altitude)
      const shadowOff = me.z * 0.12;
      ctx.fillStyle = withAlpha(tk.fg, Math.max(0.06, 0.3 - me.z * 0.02));
      ctx.beginPath();
      ctx.ellipse(me.x + shadowOff, me.y + shadowOff, rad * (1 + me.z * 0.04), rad * (1 + me.z * 0.04), 0, 0, Math.PI * 2);
      ctx.fill();

      // drone : croix + bras moteurs
      const armA = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
      const nArms = analysis.type.motorCount;
      ctx.strokeStyle = tk.fg;
      ctx.lineWidth = px * 3;
      for (let i = 0; i < nArms; i++) {
        const a = me.yaw + armA[i % 4]! + (nArms === 6 ? Math.PI / 6 : 0);
        ctx.beginPath();
        ctx.moveTo(me.x, me.y);
        ctx.lineTo(me.x + Math.cos(a) * rad, me.y + Math.sin(a) * rad);
        ctx.stroke();
        // hélice qui tourne (arc proportionnel à la poussée)
        ctx.strokeStyle = withAlpha(tk.primary, 0.35 + throttle * 0.6);
        ctx.lineWidth = px * 2;
        ctx.beginPath();
        ctx.arc(me.x + Math.cos(a) * rad, me.y + Math.sin(a) * rad, rad * 0.32, simT * 30 * throttle + i, simT * 30 * throttle + i + Math.PI * 1.4);
        ctx.stroke();
        ctx.strokeStyle = tk.fg;
        ctx.lineWidth = px * 3;
      }
      ctx.fillStyle = tk.panel;
      ctx.strokeStyle = tk.fg;
      ctx.lineWidth = px * 2;
      ctx.beginPath();
      ctx.arc(me.x, me.y, rad * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // nez
      ctx.fillStyle = tk.primary;
      ctx.beginPath();
      ctx.moveTo(me.x + Math.cos(me.yaw) * rad * 0.55, me.y + Math.sin(me.yaw) * rad * 0.55);
      ctx.lineTo(me.x + Math.cos(me.yaw + 2.6) * rad * 0.3, me.y + Math.sin(me.yaw + 2.6) * rad * 0.3);
      ctx.lineTo(me.x + Math.cos(me.yaw - 2.6) * rad * 0.3, me.y + Math.sin(me.yaw - 2.6) * rad * 0.3);
      ctx.closePath();
      ctx.fill();

      // waypoint visé + position perçue par le GPS
      if (waypoint) {
        ctx.strokeStyle = tk.warning;
        ctx.lineWidth = px * 2;
        ctx.beginPath();
        ctx.arc(waypoint[0], waypoint[1], Math.max(px * 6, rad * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (fix) {
        const ar = Math.max(px * 7, rad * 0.8);
        ctx.strokeStyle = tk.signal;
        ctx.lineWidth = px * 1.5;
        ctx.beginPath();
        ctx.arc(fix.x, fix.y, ar * 0.55, 0, Math.PI * 2);
        ctx.moveTo(fix.x - ar, fix.y);
        ctx.lineTo(fix.x + ar, fix.y);
        ctx.moveTo(fix.x, fix.y - ar);
        ctx.lineTo(fix.x, fix.y + ar);
        ctx.stroke();
      }

      // jauge d'altitude à droite
      const gx = W - px * 26;
      const gh = H * 0.5;
      const gy = (H - gh) / 2;
      ctx.fillStyle = tk.panel;
      ctx.fillRect(gx, gy, px * 10, gh);
      ctx.strokeStyle = tk.border;
      ctx.lineWidth = px;
      ctx.strokeRect(gx, gy, px * 10, gh);
      const fillH = (me.z / CEILING) * gh;
      ctx.fillStyle = me.z > CEILING * 0.85 ? tk.warning : tk.primary;
      ctx.fillRect(gx, gy + gh - fillH, px * 10, fillH);
      ctx.fillStyle = tk.fg;
      ctx.font = `${px * 10}px monospace`;
      ctx.textAlign = "right";
      const labelY = Math.max(gy + px * 12, Math.min(gy + gh, gy + gh - fillH + px * 3));
      ctx.fillText(`${me.z.toFixed(1)} m`, gx - px * 4, labelY);
      ctx.fillText(`${CEILING} m`, gx - px * 4, gy + px * 10);
      ctx.fillText("0 m", gx - px * 4, gy + gh);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      let s: ReturnType<typeof step> | null = null;
      if (!pausedRef.current) s = step(dt);
      if (s) {
        draw(s);
        if (now - lastTele > 150) {
          lastTele = now;
          const pct = Math.round(s.soc * 100);
          const items: Tele = [
            { label: "Vitesse", value: `${Math.hypot(me.vx, me.vy).toFixed(1)} m/s` },
            { label: "Gaz", value: `${Math.round(throttle * 100)} %` },
            { label: "Batterie", value: `${pct} %`, tone: batteryTone(pct) },
            { label: "Distance", value: `${dist.toFixed(0)} m` },
            { label: "Alt. max", value: `${maxAlt.toFixed(1)} m` },
          ];
          items.unshift({ label: "Altitude", value: `${me.z.toFixed(1)} m`, ...(me.z > CEILING * 0.85 ? { tone: "warn" as const } : {}) });
          items.splice(1, 0, { label: "Vitesse vert.", value: `${me.vz.toFixed(1)} m/s`, ...(me.vz < -3 ? { tone: "bad" as const } : {}) });
          if (autoOn) items.push({ label: "Waypoints", value: `${wpCount}`, tone: "ok" });
          if (caps.gpsAcc != null)
            items.push({
              label: "Précision GPS",
              value: caps.gpsAcc < 0.1 ? `± ${Math.round(caps.gpsAcc * 100)} cm` : `± ${caps.gpsAcc.toFixed(1)} m`,
              tone: caps.gpsAcc <= 0.05 ? "ok" : caps.gpsAcc <= 1.5 ? "warn" : "bad",
            });
          setTele(items);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, auto, resetKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label={paused ? "Reprendre" : "Pause"} onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button variant="secondary" size="icon" aria-label="Réinitialiser" onClick={() => setResetKey((k) => k + 1)}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
        <label className={cn("flex items-center gap-2 text-sm", autoReason && "opacity-50")}>
          <Switch checked={auto && !autoReason} onCheckedChange={setAuto} disabled={!!autoReason} />
          Vol automatique (waypoints)
        </label>
        {autoReason && <p className="text-xs text-muted-foreground">{autoReason}</p>}
      </div>

      {banner && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">{banner}</div>
      )}

      <ViewControls view={view} setView={setView} camera={camera} setCamera={setCamera} />

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
              <DroneScene3D st={st} live={liveRef} camera={camera} />
            </Suspense>
          </Scene3DBoundary>
        ) : (
          <SceneMessage>Chargement du monde 3D…</SceneMessage>
        )}
        {view === "3d" && <div className="pointer-events-none absolute bottom-2 left-2 label-tech">{CAMERA_HINT[camera]} · batterie accélérée ×{TIME_SCALE}</div>}
      </div>

      <Telemetry items={tele} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <DrivePad keys={keys} strafe vertical />
        <p className="max-w-md text-xs text-muted-foreground">
          Flèches : se déplacer et pivoter · A/E : glisser · Espace/C : monter/descendre. Survolez les bâtiments ou
          contournez-les : percuter un obstacle plus haut que votre altitude fait crasher le drone.
        </p>
      </div>
    </div>
  );
}
