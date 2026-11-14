import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { CameraMode } from "@/components/sim/scene-types";

// ---------------------------------------------------------------------------
// Couleurs : on reprend les couleurs du thème (variables CSS) pour les accents,
// et une palette « atelier » pour les matériaux.
// ---------------------------------------------------------------------------

function cssToHex(css: string, fallback: string): string {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = fallback;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

export interface SceneColors {
  primary: string;
  signal: string;
  warning: string;
  danger: string;
  success: string;
  muted: string;
}

export function useSceneColors(): SceneColors {
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, f: string) => cssToHex(cs.getPropertyValue(n).trim() || f, f);
    return {
      primary: v("--primary", "#f08a24"),
      signal: v("--signal", "#38c6d9"),
      warning: v("--warning", "#e6b422"),
      danger: v("--destructive", "#e5484d"),
      success: v("--success", "#3fb27f"),
      muted: v("--muted-foreground", "#9aa3ad"),
    };
  }, []);
}

/** Matériaux de l'atelier (béton, bois, métal…), indépendants du thème de l'interface. */
export const MAT = {
  concrete: "#8d9093",
  concreteDark: "#55595d",
  sky: "#b9c4cc",
  wood: "#a87a4c",
  metal: "#b8bcc2",
  darkMetal: "#2b2f34",
  rubber: "#1c1d1f",
  pcb: "#1f6b5a",
  battery: "#2a4d8f",
  white: "#eeeeea",
  black: "#151515",
  glass: "#2c3e50",
};

// ---------------------------------------------------------------------------
// Textures générées (aucun téléchargement)
// ---------------------------------------------------------------------------

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat?: [number, number]) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, s: number, base: string, n: number, alpha: number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const g = rnd() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${g},${g},${g},${rnd() * alpha})`;
    const r = rnd() * 2.2 + 0.4;
    ctx.fillRect(rnd() * s, rnd() * s, r, r);
  }
}

/** Sol béton : une tuile = `tile` mètres, avec lignes de grille. */
export function useConcreteTexture(W: number, H: number, tile: number, base = MAT.concrete, line = "rgba(30,30,30,0.35)") {
  const tex = useMemo(
    () =>
      canvasTex(
        512,
        (ctx, s) => {
          speckle(ctx, s, base, 9000, 0.16);
          ctx.strokeStyle = line;
          ctx.lineWidth = 3;
          ctx.strokeRect(0, 0, s, s);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(s / 2, 0);
          ctx.lineTo(s / 2, s);
          ctx.moveTo(0, s / 2);
          ctx.lineTo(s, s / 2);
          ctx.stroke();
        },
        [W / tile, H / tile],
      ),
    [W, H, tile, base, line],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

export function useCrateTexture() {
  const tex = useMemo(
    () =>
      canvasTex(256, (ctx, s) => {
        speckle(ctx, s, MAT.wood, 2500, 0.18);
        ctx.strokeStyle = "rgba(60,35,15,0.55)";
        ctx.lineWidth = 3;
        for (let i = 1; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (i * s) / 5);
          ctx.lineTo(s, (i * s) / 5);
          ctx.stroke();
        }
        ctx.lineWidth = 18;
        ctx.strokeStyle = "#8a5f36";
        ctx.strokeRect(9, 9, s - 18, s - 18);
        ctx.beginPath();
        ctx.moveTo(18, 18);
        ctx.lineTo(s - 18, s - 18);
        ctx.stroke();
      }),
    [],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

export function useHazardTexture(accent: string) {
  const tex = useMemo(
    () =>
      canvasTex(128, (ctx, s) => {
        ctx.fillStyle = MAT.black;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = accent;
        for (let i = -s; i < s * 2; i += s / 2) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + s / 4, 0);
          ctx.lineTo(i + s / 4 - s, s);
          ctx.lineTo(i - s, s);
          ctx.closePath();
          ctx.fill();
        }
      }),
    [accent],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

export function useFacadeTexture() {
  const tex = useMemo(
    () =>
      canvasTex(256, (ctx, s) => {
        speckle(ctx, s, "#9c968c", 3000, 0.12);
        let seed = 3;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        // 2 colonnes × 2 étages de fenêtres par tuile
        for (let cx = 0; cx < 2; cx++)
          for (let cy = 0; cy < 2; cy++) {
            const lit = rnd() > 0.7;
            ctx.fillStyle = lit ? "#e9d9a6" : MAT.glass;
            ctx.fillRect(cx * (s / 2) + s * 0.08, cy * (s / 2) + s * 0.1, s * 0.34, s * 0.28);
            ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.fillRect(cx * (s / 2) + s * 0.08, cy * (s / 2) + s * 0.1, s * 0.34, s * 0.04);
          }
      }),
    [],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

export function usePadTexture(accent: string) {
  const tex = useMemo(
    () =>
      canvasTex(256, (ctx, s) => {
        ctx.fillStyle = MAT.darkMetal;
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = MAT.white;
        ctx.font = `bold ${s * 0.5}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", s / 2, s / 2 + s * 0.02);
      }),
    [accent],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

// ---------------------------------------------------------------------------
// Lumières
// ---------------------------------------------------------------------------

export function SceneLights({ size, center }: { size: number; center: [number, number] }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    const half = size * 0.75;
    const cam = l.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.1;
    cam.far = size * 4;
    cam.updateProjectionMatrix();
    l.target.position.set(center[0], 0, center[1]);
    l.target.updateMatrixWorld();
  }, [size, center]);
  return (
    <>
      <hemisphereLight args={["#dfe7ee", "#5b5148", 0.55]} />
      <directionalLight
        ref={light}
        castShadow
        intensity={2.2}
        color="#fff4e3"
        position={[center[0] - size * 0.6, size * 1.2, center[1] - size * 0.4]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <Environment resolution={64}>
        <Lightformer intensity={1.6} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
        <Lightformer intensity={0.8} color="#ffd9b0" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 2, 1]} />
        <Lightformer intensity={0.6} color="#bcd4ff" position={[5, 1, 1]} rotation-y={-Math.PI / 2} scale={[20, 2, 1]} />
      </Environment>
    </>
  );
}

// ---------------------------------------------------------------------------
// Caméra : poursuite, orbite libre, vue de dessus
// ---------------------------------------------------------------------------

export interface Follow {
  x: number;
  y: number; // hauteur
  z: number;
  heading: number;
}

export function CameraRig({
  mode,
  getTarget,
  dist,
  height,
  arena,
}: {
  mode: CameraMode;
  getTarget: () => Follow;
  dist: number;
  height: number;
  arena: { W: number; H: number };
}) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3());
  const first = useRef(true);

  useEffect(() => {
    first.current = true;
    camera.up.set(0, 1, 0);
    if (mode === "orbit") {
      const s = Math.max(arena.W, arena.H);
      camera.position.set(arena.W * 0.5 - s * 0.55, s * 0.55, arena.H * 0.5 + s * 0.75);
      camera.lookAt(arena.W / 2, 0, arena.H / 2);
    }
    if (mode === "top") {
      camera.up.set(0, 0, -1);
    }
  }, [mode, camera, arena.W, arena.H]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = getTarget();
    if (mode === "chase") {
      const dx = Math.cos(t.heading);
      const dz = Math.sin(t.heading);
      const want = new THREE.Vector3(t.x - dx * dist, t.y + height, t.z - dz * dist);
      const wantLook = new THREE.Vector3(t.x + dx * dist * 0.6, t.y, t.z + dz * dist * 0.6);
      const k = first.current ? 1 : 1 - Math.exp(-5 * dt);
      first.current = false;
      camera.position.lerp(want, k);
      look.current.lerp(wantLook, k);
      camera.lookAt(look.current);
    } else if (mode === "top") {
      const s = Math.max(arena.W, arena.H / 0.62);
      camera.position.set(arena.W / 2, s * 0.95, arena.H / 2);
      camera.lookAt(arena.W / 2, 0, arena.H / 2);
    }
  });

  return mode === "orbit" ? (
    <OrbitControls makeDefault target={[arena.W / 2, 0, arena.H / 2]} maxPolarAngle={Math.PI / 2.05} enableDamping />
  ) : null;
}

// ---------------------------------------------------------------------------
// Segments (rayons capteurs) mis à jour à chaque image sans React
// ---------------------------------------------------------------------------

export function DynamicSegments({
  max,
  color,
  opacity,
  fill,
}: {
  max: number;
  color: string;
  opacity: number;
  /** Écrit des paires de points (x,y,z,x,y,z) dans `out` et retourne le nombre de segments. */
  fill: (out: Float32Array) => number;
}) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 6), 3));
    g.setDrawRange(0, 0);
    return g;
  }, [max]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(() => {
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    const n = Math.min(max, fill(attr.array as Float32Array));
    geo.setDrawRange(0, n * 2);
    attr.needsUpdate = true;
    geo.computeBoundingSphere();
  });
  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------
// Signal « scène prête » + garde-fou d'erreur
// ---------------------------------------------------------------------------

export function ReadySignal() {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
    if (frames.current === 3) gl.domElement.closest("[data-scene-root]")?.setAttribute("data-scene-ready", "true");
  });
  return null;
}

export class Scene3DBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.error("Vue 3D indisponible :", err);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
