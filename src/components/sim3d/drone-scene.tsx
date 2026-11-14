import { Html } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { CameraMode, DroneLive, DroneStatic } from "@/components/sim/scene-types";
import {
  CameraRig,
  DynamicSegments,
  MAT,
  ReadySignal,
  SceneLights,
  useConcreteTexture,
  useFacadeTexture,
  useHazardTexture,
  usePadTexture,
  useSceneColors,
  type SceneColors,
} from "./common";

// x (2D) → X, y (2D) → Z, altitude → Y. Le nez du drone regarde vers +X.

function DroneModel({ st, live, colors }: { st: DroneStatic; live: MutableRefObject<DroneLive | null>; colors: SceneColors }) {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const props = useRef<THREE.Group[]>([]);
  const discs = useRef<THREE.Mesh[]>([]);
  const rad = st.span / 2;
  const n = st.motorCount;
  const armL = rad * 0.72;
  const propR = rad * 0.3;
  const legH = rad * 0.22;
  const arms = useMemo(() => Array.from({ length: n }, (_, i) => (i * Math.PI * 2) / n + (n === 4 ? Math.PI / 4 : 0)), [n]);
  const sm = useRef({ pitch: 0, roll: 0 });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const L = live.current;
    const g = root.current;
    if (!L || !g) return;
    const { me } = L;
    g.position.set(me.x, me.z + legH, me.y);
    g.rotation.y = -me.yaw;
    // inclinaison proportionnelle à la vitesse dans le repère du drone
    const c = Math.cos(me.yaw);
    const s = Math.sin(me.yaw);
    const fwd = c * me.vx + s * me.vy;
    const side = -s * me.vx + c * me.vy;
    const k = 1 - Math.exp(-6 * dt);
    sm.current.pitch += (-Math.max(-0.4, Math.min(0.4, fwd * 0.05)) - sm.current.pitch) * k;
    sm.current.roll += (Math.max(-0.4, Math.min(0.4, side * 0.05)) - sm.current.roll) * k;
    if (tilt.current) {
      tilt.current.rotation.z = me.z > 0.02 ? sm.current.pitch : 0;
      tilt.current.rotation.x = me.z > 0.02 ? sm.current.roll : 0;
    }
    const speed = L.throttle * 70;
    props.current.forEach((p, i) => p && (p.rotation.y += speed * dt * (i % 2 ? 1 : -1)));
    discs.current.forEach((d) => {
      if (!d) return;
      const m = d.material as THREE.MeshBasicMaterial;
      m.opacity = Math.min(0.35, L.throttle * 0.45);
      d.visible = L.throttle > 0.15;
    });
  });

  return (
    <group ref={root}>
      <group ref={tilt}>
        {/* corps */}
        <mesh castShadow>
          <boxGeometry args={[rad * 0.55, rad * 0.14, rad * 0.32]} />
          <meshStandardMaterial color={MAT.darkMetal} roughness={0.45} metalness={0.4} />
        </mesh>
        <mesh position-y={rad * 0.1} castShadow>
          <boxGeometry args={[rad * 0.42, rad * 0.06, rad * 0.26]} />
          <meshStandardMaterial color={colors.primary} roughness={0.5} />
        </mesh>
        <mesh position={[rad * 0.25, 0, 0]}>
          <boxGeometry args={[rad * 0.08, rad * 0.06, rad * 0.12]} />
          <meshStandardMaterial color={MAT.glass} metalness={0.9} roughness={0.1} />
        </mesh>
        {/* bras + moteurs + hélices */}
        {arms.map((a, i) => (
          <group key={i} rotation-y={-a}>
            <mesh position-x={armL / 2} rotation-z={Math.PI / 2} castShadow>
              <cylinderGeometry args={[rad * 0.03, rad * 0.03, armL, 8]} />
              <meshStandardMaterial color={MAT.black} roughness={0.5} />
            </mesh>
            <mesh position={[armL, rad * 0.04, 0]} castShadow>
              <cylinderGeometry args={[rad * 0.07, rad * 0.07, rad * 0.1, 16]} />
              <meshStandardMaterial color={MAT.metal} metalness={0.8} roughness={0.25} />
            </mesh>
            <group position={[armL, rad * 0.1, 0]} ref={(g) => void (g && (props.current[i] = g))}>
              <mesh castShadow>
                <boxGeometry args={[propR * 2, rad * 0.008, propR * 0.16]} />
                <meshStandardMaterial color={i < 2 ? colors.primary : MAT.black} roughness={0.5} />
              </mesh>
            </group>
            <mesh position={[armL, rad * 0.1, 0]} rotation-x={-Math.PI / 2} ref={(m) => void (m && (discs.current[i] = m))}>
              <circleGeometry args={[propR, 24]} />
              <meshBasicMaterial color={MAT.metal} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {/* patins */}
            {i % Math.max(1, n / 4) === 0 && (
              <mesh position={[armL * 0.45, -legH / 2, 0]}>
                <cylinderGeometry args={[rad * 0.015, rad * 0.015, legH, 6]} />
                <meshStandardMaterial color={MAT.black} />
              </mesh>
            )}
          </group>
        ))}
        {st.hasGps && (
          <group position={[-rad * 0.15, rad * 0.13, 0]}>
            <mesh position-y={rad * 0.1}>
              <cylinderGeometry args={[rad * 0.012, rad * 0.012, rad * 0.2, 6]} />
              <meshStandardMaterial color={MAT.black} />
            </mesh>
            <mesh position-y={rad * 0.21}>
              <cylinderGeometry args={[rad * 0.07, rad * 0.07, rad * 0.025, 16]} />
              <meshStandardMaterial color={MAT.white} roughness={0.6} />
            </mesh>
          </group>
        )}
        {st.hasLidar && (
          <mesh position-y={-rad * 0.12}>
            <cylinderGeometry args={[rad * 0.08, rad * 0.08, rad * 0.06, 16]} />
            <meshStandardMaterial color={colors.signal} emissive={colors.signal} emissiveIntensity={0.3} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function City({ st, colors }: { st: DroneStatic; colors: SceneColors }) {
  const { W, H } = st;
  const ground = useConcreteTexture(W, H, 1);
  const outer = useConcreteTexture(W * 5, H * 5, 2, "#6f7a5e", "rgba(0,0,0,0.12)");
  const facade = useFacadeTexture();
  const roofTex = useHazardTexture(colors.warning);
  const pad = usePadTexture(colors.primary);
  const facades = useMemo(
    () =>
      st.buildings.map((b) => {
        const mk = (rx: number) => {
          const t = facade.clone();
          t.repeat.set(Math.max(1, rx / 2.5), Math.max(1, b.alt / 2.5));
          t.needsUpdate = true;
          return t;
        };
        return { x: mk(b.w), z: mk(b.h) };
      }),
    [st.buildings, facade],
  );
  useEffect(() => () => facades.forEach((f) => (f.x.dispose(), f.z.dispose())), [facades]);
  const padSize = Math.max(1.2, st.span * 3);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[W / 2, -0.01, H / 2]} receiveShadow>
        <planeGeometry args={[W * 5, H * 5]} />
        <meshStandardMaterial map={outer} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[W / 2, 0, H / 2]} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial map={ground} roughness={0.9} />
      </mesh>
      {/* bordure de la zone de vol */}
      {(
        [
          [W / 2, 0, W, 0.12],
          [W / 2, H, W, 0.12],
          [0, H / 2, 0.12, H],
          [W, H / 2, 0.12, H],
        ] as const
      ).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.005, z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial color={colors.warning} />
        </mesh>
      ))}
      <mesh position={[st.start.x, 0.01, st.start.y]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[padSize, padSize]} />
        <meshStandardMaterial map={pad} roughness={0.7} />
      </mesh>
      {st.buildings.map((b, i) => {
        const mats = [
          { map: facades[i]!.z },
          { map: facades[i]!.z },
          { map: roofTex },
          { map: roofTex },
          { map: facades[i]!.x },
          { map: facades[i]!.x },
        ];
        return (
          <group key={i} position={[b.x + b.w / 2, 0, b.y + b.h / 2]}>
            <mesh position-y={b.alt / 2} castShadow receiveShadow>
              <boxGeometry args={[b.w, b.alt, b.h]} />
              {mats.map((m, k) => (
                <meshStandardMaterial key={k} attach={`material-${k}`} map={m.map} roughness={0.85} color={k === 2 ? MAT.concreteDark : "#ffffff"} />
              ))}
            </mesh>
            <Html position={[0, b.alt + 0.5, 0]} center distanceFactor={18} zIndexRange={[10, 0]}>
              <div className="pointer-events-none whitespace-nowrap rounded bg-card/90 px-1.5 py-0.5 font-mono text-xs text-foreground shadow-panel">{b.alt} m</div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function DroneFx({ st, live, colors }: { st: DroneStatic; live: MutableRefObject<DroneLive | null>; colors: SceneColors }) {
  const wp = useRef<THREE.Group>(null);
  const blob = useRef<THREE.Mesh>(null);
  const legH = (st.span / 2) * 0.22;
  useFrame((state) => {
    const L = live.current;
    if (!L) return;
    if (wp.current) {
      wp.current.visible = !!L.waypoint;
      if (L.waypoint) {
        wp.current.position.set(L.waypoint[0], 0, L.waypoint[1]);
        wp.current.rotation.y = state.clock.elapsedTime;
      }
    }
    const b = blob.current;
    if (b) {
      const { x, y, z } = L.me;
      let floor = 0;
      for (const bd of st.buildings) if (x >= bd.x && x <= bd.x + bd.w && y >= bd.y && y <= bd.y + bd.h && bd.alt <= z + 0.01) floor = Math.max(floor, bd.alt);
      b.position.set(x, floor + 0.02, y);
      const h = Math.max(0, z - floor);
      b.scale.setScalar(1 + h * 0.05);
      (b.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.45 - h * 0.03);
    }
  });
  const ringR = Math.max(0.6, st.span * 1.2);
  return (
    <>
      <group ref={wp} visible={false}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
          <ringGeometry args={[ringR * 0.8, ringR, 32]} />
          <meshBasicMaterial color={colors.primary} side={THREE.DoubleSide} />
        </mesh>
        <mesh position-y={st.ceiling / 2}>
          <cylinderGeometry args={[ringR * 0.15, ringR * 0.15, st.ceiling, 12, 1, true]} />
          <meshBasicMaterial color={colors.primary} transparent opacity={0.25} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <mesh ref={blob} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[st.span * 0.5, 24]} />
        <meshBasicMaterial color={MAT.black} transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <DynamicSegments
        max={16}
        color={colors.warning}
        opacity={0.9}
        fill={(out) => {
          const L = live.current;
          if (!L) return 0;
          const { x, y, z } = L.me;
          L.rays.forEach((r, i) => out.set([x, z + legH, y, x + Math.cos(r.a) * r.d, z + legH, y + Math.sin(r.a) * r.d], i * 6));
          return L.rays.length;
        }}
      />
      {st.hasLidar && (
        <DynamicSegments
          max={90}
          color={colors.signal}
          opacity={0.3}
          fill={(out) => {
            const L = live.current;
            if (!L) return 0;
            const { x, y, z } = L.me;
            L.scan.forEach((r, i) => out.set([x, z + legH * 0.5, y, x + Math.cos(r.a) * r.d, z + legH * 0.5, y + Math.sin(r.a) * r.d], i * 6));
            return Math.min(90, L.scan.length);
          }}
        />
      )}
    </>
  );
}

export default function DroneScene3D({ st, live, camera }: { st: DroneStatic; live: MutableRefObject<DroneLive | null>; camera: CameraMode }) {
  const colors = useSceneColors();
  const size = Math.max(st.W, st.H);
  const chaseDist = Math.max(3, st.span * 6);
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 55, near: 0.05, far: size * 15, position: [st.W / 2, size, st.H * 1.3] }} gl={{ antialias: true }}>
      <color attach="background" args={[MAT.sky]} />
      <fog attach="fog" args={[MAT.sky, size * 1.2, size * 4]} />
      <SceneLights size={size} center={[st.W / 2, st.H / 2]} />
      <City st={st} colors={colors} />
      <DroneModel st={st} live={live} colors={colors} />
      <DroneFx st={st} live={live} colors={colors} />
      <CameraRig
        mode={camera}
        arena={{ W: st.W, H: st.H }}
        dist={chaseDist}
        height={chaseDist * 0.45}
        getTarget={() => {
          const L = live.current;
          return L ? { x: L.me.x, y: L.me.z + 0.3, z: L.me.y, heading: L.me.yaw } : { x: 0, y: 0, z: 0, heading: 0 };
        }}
      />
      <ReadySignal />
    </Canvas>
  );
}
