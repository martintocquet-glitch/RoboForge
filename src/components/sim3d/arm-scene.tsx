import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import type * as THREE from "three";
import type { ArmLive, ArmStatic, CameraMode } from "@/components/sim/scene-types";
import { CameraRig, MAT, ReadySignal, SceneLights, useConcreteTexture, useSceneColors } from "./common";

// x (2D) → X, y (2D) → Z, hauteur → Y.
export default function ArmScene({ st, live, camera }: { st: ArmStatic; live: MutableRefObject<ArmLive | null>; camera: CameraMode }) {
  const size = Math.max(st.W, st.H);
  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 50, near: 0.01, far: size * 20, position: [st.W / 2, size * 0.6, st.H * 1.2] }}>
      <color attach="background" args={[MAT.sky]} />
      <SceneLights size={size} center={[st.W / 2, st.H / 2]} />
      <Bench st={st} />
      <Arm st={st} live={live} />
      <Cubes st={st} live={live} />
      <CameraRig
        mode={camera}
        arena={{ W: st.W, H: st.H }}
        dist={size * 0.5}
        height={size * 0.3}
        getTarget={() => {
          const L = live.current;
          return L ? { x: L.tip.x, y: L.tip.z, z: L.tip.y, heading: L.q0 } : { x: st.W / 2, y: 0, z: st.H / 2, heading: 0 };
        }}
      />
      <ReadySignal />
    </Canvas>
  );
}

function Bench({ st }: { st: ArmStatic }) {
  const tex = useConcreteTexture(st.W, st.H, st.W / 6, MAT.wood, "rgba(60,40,20,0.25)");
  const b = st.bin;
  const t = b.w * 0.05;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[st.W / 2, 0, st.H / 2]} receiveShadow>
        <planeGeometry args={[st.W, st.H]} />
        <meshStandardMaterial map={tex} roughness={0.8} />
      </mesh>
      <group position={[b.x + b.w / 2, 0, b.y + b.h / 2]}>
        {[
          [0, b.h / 2, b.w, t],
          [0, -b.h / 2, b.w, t],
          [b.w / 2, 0, t, b.h],
          [-b.w / 2, 0, t, b.h],
        ].map(([x, z, w, d], i) => (
          <mesh key={i} position={[x!, b.depth / 2, z!]} castShadow>
            <boxGeometry args={[w!, b.depth, d!]} />
            <meshStandardMaterial color="#3a7d5a" roughness={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Arm({ st, live }: { st: ArmStatic; live: MutableRefObject<ArmLive | null> }) {
  const c = useSceneColors();
  const base = useRef<THREE.Group>(null);
  const sh = useRef<THREE.Group>(null);
  const el = useRef<THREE.Group>(null);
  const wr = useRef<THREE.Group>(null);
  const f1 = useRef<THREE.Mesh>(null);
  const f2 = useRef<THREE.Mesh>(null);
  const w = st.L1 * 0.12;
  useFrame(() => {
    const L = live.current;
    if (!L || !base.current || !sh.current || !el.current || !wr.current) return;
    base.current.rotation.y = L.q0;
    sh.current.rotation.z = L.q1;
    el.current.rotation.z = L.q2;
    wr.current.rotation.z = -(L.q1 + L.q2);
    const open = w * (0.9 - L.grip * 0.55);
    f1.current?.position.setZ(open);
    f2.current?.position.setZ(-open);
  });
  // rotation.y = q0 avec x→X et y→Z : on retourne l'axe Z pour garder le même sens.
  return (
    <group position={[st.base.x, 0, st.base.y]} scale={[1, 1, -1]}>
      <mesh position-y={st.baseH * 0.15} castShadow>
        <cylinderGeometry args={[w * 1.6, w * 1.9, st.baseH * 0.3, 24]} />
        <meshStandardMaterial color={MAT.darkMetal} metalness={0.5} roughness={0.4} />
      </mesh>
      <group ref={base}>
        <mesh position-y={st.baseH * 0.6} castShadow>
          <boxGeometry args={[w * 1.4, st.baseH * 0.7, w * 1.4]} />
          <meshStandardMaterial color={c.primary} roughness={0.5} />
        </mesh>
        <group ref={sh} position-y={st.baseH}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[w * 0.8, w * 0.8, w * 1.6, 16]} />
            <meshStandardMaterial color={MAT.darkMetal} />
          </mesh>
          <mesh position-x={st.L1 / 2} castShadow>
            <boxGeometry args={[st.L1, w, w]} />
            <meshStandardMaterial color={MAT.metal} metalness={0.6} roughness={0.35} />
          </mesh>
          <group ref={el} position-x={st.L1}>
            <mesh rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[w * 0.65, w * 0.65, w * 1.3, 16]} />
              <meshStandardMaterial color={MAT.darkMetal} />
            </mesh>
            <mesh position-x={st.L2 / 2} castShadow>
              <boxGeometry args={[st.L2, w * 0.8, w * 0.8]} />
              <meshStandardMaterial color={c.primary} roughness={0.5} />
            </mesh>
            <group ref={wr} position-x={st.L2}>
              <mesh position-y={-st.tool * 0.25}>
                <boxGeometry args={[w * 0.9, st.tool * 0.5, w * 2]} />
                <meshStandardMaterial color={MAT.darkMetal} />
              </mesh>
              {st.suction ? (
                <mesh position-y={-st.tool * 0.85}>
                  <cylinderGeometry args={[w * 0.5, w * 0.3, st.tool * 0.3, 16]} />
                  <meshStandardMaterial color={MAT.rubber} />
                </mesh>
              ) : (
                <>
                  <mesh ref={f1} position-y={-st.tool * 0.75} castShadow>
                    <boxGeometry args={[w * 0.5, st.tool * 0.5, w * 0.15]} />
                    <meshStandardMaterial color={MAT.metal} metalness={0.6} />
                  </mesh>
                  <mesh ref={f2} position-y={-st.tool * 0.75} castShadow>
                    <boxGeometry args={[w * 0.5, st.tool * 0.5, w * 0.15]} />
                    <meshStandardMaterial color={MAT.metal} metalness={0.6} />
                  </mesh>
                </>
              )}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

const CUBE_COLORS = ["#4aa3df", "#3fb27f", "#e6b422", "#e07b39", "#c44b4b"];

function Cubes({ st, live }: { st: ArmStatic; live: MutableRefObject<ArmLive | null> }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const objs = live.current?.objects ?? [];
  useFrame(() => {
    const L = live.current;
    if (!L) return;
    L.objects.forEach((o, i) => {
      const m = refs.current[i];
      if (m) m.position.set(o.x, o.z + o.size / 2, o.y);
    });
  });
  return (
    <>
      {objs.map((o, i) => (
        <mesh key={`${st.W}-${o.id}`} ref={(m) => void (refs.current[i] = m)} castShadow>
          <boxGeometry args={[o.size, o.size, o.size]} />
          <meshStandardMaterial color={CUBE_COLORS[i % CUBE_COLORS.length]} roughness={0.5} />
        </mesh>
      ))}
    </>
  );
}
