import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { CameraMode, GroundLive, GroundStatic, Pose } from "@/components/sim/scene-types";
import {
  CameraRig,
  DynamicSegments,
  MAT,
  ReadySignal,
  SceneLights,
  useConcreteTexture,
  useCrateTexture,
  useHazardTexture,
  useSceneColors,
  type SceneColors,
} from "./common";

// Dans la scène : x (2D) → X, y (2D) → Z, la hauteur est Y. Le robot regarde vers +X.

function dims(st: GroundStatic) {
  const { len, wid } = st;
  const legged = st.propKind === "leg";
  const r = legged ? 0 : Math.max(len * 0.1, Math.min(len * 0.42, st.wheelD / 2));
  const plateT = Math.max(0.003, len * 0.03);
  const humanoid = st.typeId === "humanoid";
  const bodyY = legged ? (humanoid ? Math.max(0.12, len * 0.9) : Math.max(0.03, wid * 0.35)) : r + plateT / 2;
  const topY = bodyY + (humanoid ? len * 0.9 : plateT / 2 + Math.max(0.012, len * 0.08));
  const obsH = Math.max(0.15, Math.min(0.8, len * 2.5, humanoid ? 1 : 0.8));
  return { r, plateT, bodyY, topY, obsH, humanoid, legged };
}

// ---------------------------------------------------------------------------
// Robot procédural, construit à partir des pièces choisies dans l'atelier
// ---------------------------------------------------------------------------

function Wheel({ r, w, color, hub }: { r: number; w: number; color: string; hub: string }) {
  return (
    <group rotation-x={Math.PI / 2}>
      <mesh castShadow>
        <cylinderGeometry args={[r, r, w, 24]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position-y={0.0001}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, w * 1.04, 16]} />
        <meshStandardMaterial color={hub} roughness={0.4} metalness={0.6} />
      </mesh>
    </group>
  );
}

function Segment({ refCb, radius, color }: { refCb: (m: THREE.Mesh | null) => void; radius: number; color: string }) {
  return (
    <mesh ref={refCb} castShadow>
      <cylinderGeometry args={[radius, radius, 1, 8]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.5} />
    </mesh>
  );
}

const UP = new THREE.Vector3(0, 1, 0);
function placeSegment(m: THREE.Mesh | undefined | null, a: THREE.Vector3, b: THREE.Vector3) {
  if (!m) return;
  const d = new THREE.Vector3().subVectors(b, a);
  const l = d.length();
  m.position.copy(a).addScaledVector(d, 0.5);
  m.scale.set(1, Math.max(1e-4, l), 1);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
}

function Legs({ st, pose, accent }: { st: GroundStatic; pose: () => { gait: number }; accent: string }) {
  const { len, wid } = st;
  const { bodyY, humanoid } = dims(st);
  const pairs = humanoid ? 1 : st.typeId === "hexapod" ? 3 : 2;
  const legs = useMemo(() => {
    const out: { hip: THREE.Vector3; side: number; phase: number; x: number }[] = [];
    for (let i = 0; i < pairs; i++) {
      const x = pairs === 1 ? 0 : (i / (pairs - 1) - 0.5) * len * 0.75;
      for (const side of [-1, 1]) {
        out.push({
          hip: new THREE.Vector3(x, humanoid ? bodyY - len * 0.1 : bodyY, side * (humanoid ? wid * 0.18 : wid * 0.35)),
          side,
          // trépied alterné (hexapode) / alternance gauche-droite (bipède)
          phase: (i + (side > 0 ? 1 : 0)) % 2 ? Math.PI : 0,
          x,
        });
      }
    }
    return out;
  }, [pairs, len, wid, bodyY, humanoid]);
  const upper = useRef<THREE.Mesh[]>([]);
  const lower = useRef<THREE.Mesh[]>([]);
  const knee = new THREE.Vector3();
  const foot = new THREE.Vector3();
  useFrame(() => {
    const g = pose().gait;
    legs.forEach((l, i) => {
      const s = Math.sin(g + l.phase);
      const lift = Math.max(0, Math.cos(g + l.phase)) * bodyY * 0.25;
      if (humanoid) {
        foot.set(l.x + s * len * 0.25, lift * 0.6, l.hip.z);
        knee.set((l.hip.x + foot.x) / 2 + len * 0.08, (l.hip.y + foot.y) / 2, l.hip.z);
      } else {
        const reach = wid * 0.55;
        foot.set(l.x + s * len * 0.12, lift, l.side * (wid * 0.35 + reach));
        knee.set(l.x + s * len * 0.06, bodyY + wid * 0.12 + lift * 0.5, l.side * (wid * 0.35 + reach * 0.45));
      }
      placeSegment(upper.current[i], l.hip, knee);
      placeSegment(lower.current[i], knee, foot);
    });
  });
  const rad = humanoid ? len * 0.07 : Math.max(0.003, wid * 0.04);
  return (
    <>
      {legs.map((_, i) => (
        <group key={i}>
          <Segment refCb={(m) => void (m && (upper.current[i] = m))} radius={rad} color={MAT.metal} />
          <Segment refCb={(m) => void (m && (lower.current[i] = m))} radius={rad * 0.8} color={accent} />
        </group>
      ))}
    </>
  );
}

function RobotModel({
  st,
  pose,
  accent,
  colors,
  opponent,
}: {
  st: GroundStatic;
  pose: () => Pose & { gait: number };
  accent: string;
  colors: SceneColors;
  opponent?: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Group[]>([]);
  const lidarHead = useRef<THREE.Mesh>(null);
  const spin = useRef(0);
  const { len, wid } = st;
  const { r, plateT, bodyY, topY, legged, humanoid } = dims(st);
  const kind = opponent ? "wheel" : st.propKind;
  const ww = Math.max(0.008, wid * 0.16);
  const pairs = opponent ? 1 : st.wheelPairs;

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = pose();
    const g = root.current;
    if (!g) return;
    g.position.set(p.x, 0, p.y);
    g.rotation.y = -p.th;
    if (r > 0) spin.current -= (p.v * dt) / r;
    for (const w of wheels.current) if (w) w.rotation.z = spin.current;
    if (lidarHead.current) lidarHead.current.rotation.y += dt * 12;
  });

  const wheelXs = pairs === 1 ? [len * 0.12] : [-len * 0.3, len * 0.3];
  const sensorY = legged ? bodyY + wid * 0.05 : bodyY + plateT;

  return (
    <group ref={root}>
      {/* châssis */}
      {humanoid ? (
        <>
          <mesh position={[0, bodyY + len * 0.4, 0]} castShadow>
            <boxGeometry args={[len * 0.45, len * 0.8, wid * 0.55]} />
            <meshStandardMaterial color={accent} roughness={0.5} metalness={0.2} />
          </mesh>
          <mesh position={[0, bodyY + len * 0.95, 0]} castShadow>
            <boxGeometry args={[len * 0.35, len * 0.3, len * 0.35]} />
            <meshStandardMaterial color={MAT.darkMetal} roughness={0.4} metalness={0.4} />
          </mesh>
          <mesh position={[len * 0.18, bodyY + len * 0.97, 0]}>
            <boxGeometry args={[0.01, len * 0.08, len * 0.22]} />
            <meshStandardMaterial color={colors.signal} emissive={colors.signal} emissiveIntensity={0.6} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, bodyY + len * 0.45, s * wid * 0.36]} castShadow>
              <boxGeometry args={[len * 0.12, len * 0.7, len * 0.12]} />
              <meshStandardMaterial color={MAT.metal} metalness={0.5} roughness={0.4} />
            </mesh>
          ))}
        </>
      ) : legged ? (
        <mesh position={[0, bodyY, 0]} castShadow>
          <cylinderGeometry args={[wid * 0.42, wid * 0.42, Math.max(0.01, wid * 0.12), 6]} />
          <meshStandardMaterial color={accent} roughness={0.5} metalness={0.2} />
        </mesh>
      ) : (
        <mesh position={[0, bodyY, 0]} castShadow receiveShadow>
          <boxGeometry args={[len, plateT, wid * 0.78]} />
          <meshStandardMaterial color={accent} roughness={0.45} metalness={0.25} />
        </mesh>
      )}
      {legged && <Legs st={st} pose={pose} accent={MAT.darkMetal} />}

      {/* roues / chenilles */}
      {!legged && kind === "track"
        ? [-1, 1].map((s) => (
            <group key={s} position={[0, r, s * (wid * 0.39 + ww / 2)]}>
              <mesh castShadow>
                <boxGeometry args={[len * 0.8, r * 2, ww]} />
                <meshStandardMaterial color={MAT.rubber} roughness={0.95} />
              </mesh>
              {[-1, 1].map((e) => (
                <mesh key={e} position-x={e * len * 0.4} rotation-x={Math.PI / 2} castShadow>
                  <cylinderGeometry args={[r, r, ww, 20]} />
                  <meshStandardMaterial color={MAT.rubber} roughness={0.95} />
                </mesh>
              ))}
            </group>
          ))
        : !legged &&
          wheelXs.flatMap((x, i) =>
            [-1, 1].map((s) => (
              <group
                key={`${i}${s}`}
                position={[x, r, s * (wid * 0.39 + ww / 2)]}
                ref={(g) => void (g && (wheels.current[i * 2 + (s > 0 ? 1 : 0)] = g))}
              >
                <Wheel r={r} w={ww} color={kind === "mecanum" ? MAT.darkMetal : MAT.rubber} hub={kind === "mecanum" ? colors.warning : MAT.metal} />
              </group>
            )),
          )}
      {!legged && kind !== "track" && pairs === 1 && (
        <mesh position={[-len * 0.36, Math.max(0.004, r * 0.35), 0]} castShadow>
          <sphereGeometry args={[Math.max(0.004, r * 0.35), 12, 12]} />
          <meshStandardMaterial color={MAT.metal} metalness={0.8} roughness={0.2} />
        </mesh>
      )}

      {/* électronique : carte, batterie */}
      {!humanoid && (
        <>
          <mesh position={[len * 0.02, sensorY + 0.004, 0]} castShadow>
            <boxGeometry args={[len * 0.38, Math.max(0.002, len * 0.012), wid * 0.4]} />
            <meshStandardMaterial color={opponent ? MAT.darkMetal : MAT.pcb} roughness={0.6} />
          </mesh>
          <mesh position={[-len * 0.28, sensorY + Math.max(0.006, len * 0.04), 0]} castShadow>
            <boxGeometry args={[len * 0.26, Math.max(0.012, len * 0.08), wid * 0.35]} />
            <meshStandardMaterial color={MAT.battery} roughness={0.5} />
          </mesh>
        </>
      )}
      {opponent && (
        <mesh position={[len * 0.42, r * 0.6, 0]} rotation-z={-0.5} castShadow>
          <boxGeometry args={[len * 0.2, plateT * 1.5, wid * 0.8]} />
          <meshStandardMaterial color={MAT.metal} metalness={0.8} roughness={0.25} />
        </mesh>
      )}

      {/* capteurs */}
      {!opponent &&
        st.sensorOffsets.map((off, i) => (
          <group key={i} position={[Math.cos(off) * len * 0.5, sensorY + Math.max(0.008, len * 0.05), Math.sin(off) * len * 0.5 * (wid / len)]} rotation-y={-off}>
            <mesh>
              <boxGeometry args={[Math.max(0.002, len * 0.01), Math.max(0.01, len * 0.13), Math.max(0.02, len * 0.3)]} />
              <meshStandardMaterial color={MAT.battery} roughness={0.6} />
            </mesh>
            {[-1, 1].map((e) => (
              <mesh key={e} position={[Math.max(0.004, len * 0.03), 0, e * Math.max(0.006, len * 0.08)]} rotation-z={Math.PI / 2}>
                <cylinderGeometry args={[Math.max(0.004, len * 0.05), Math.max(0.004, len * 0.05), Math.max(0.006, len * 0.06), 16]} />
                <meshStandardMaterial color={MAT.metal} metalness={0.9} roughness={0.25} />
              </mesh>
            ))}
          </group>
        ))}
      {!opponent && st.hasLidar && (
        <group position={[len * 0.05, topY + Math.max(0.01, len * 0.06), 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[Math.max(0.012, len * 0.13), Math.max(0.012, len * 0.13), Math.max(0.01, len * 0.08), 24]} />
            <meshStandardMaterial color={MAT.darkMetal} roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh ref={lidarHead} position-y={Math.max(0.008, len * 0.06)}>
            <cylinderGeometry args={[Math.max(0.01, len * 0.1), Math.max(0.01, len * 0.11), Math.max(0.008, len * 0.05), 6]} />
            <meshStandardMaterial color={colors.signal} emissive={colors.signal} emissiveIntensity={0.35} />
          </mesh>
        </group>
      )}
      {!opponent && st.hasCamera && (
        <group position={[len * 0.38, topY, 0]}>
          <mesh castShadow>
            <boxGeometry args={[Math.max(0.01, len * 0.06), Math.max(0.01, len * 0.07), Math.max(0.015, len * 0.12)]} />
            <meshStandardMaterial color={MAT.black} roughness={0.3} />
          </mesh>
          <mesh position-x={Math.max(0.006, len * 0.035)} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[Math.max(0.003, len * 0.025), Math.max(0.003, len * 0.025), Math.max(0.004, len * 0.02), 16]} />
            <meshStandardMaterial color={MAT.glass} metalness={0.9} roughness={0.05} />
          </mesh>
        </group>
      )}
      {!opponent && st.hasLine && !legged && (
        <mesh position={[len * 0.5, Math.max(0.003, r * 0.25), 0]}>
          <boxGeometry args={[Math.max(0.006, len * 0.06), Math.max(0.002, len * 0.015), Math.max(wid * 0.6, 0.02)]} />
          <meshStandardMaterial color={MAT.black} roughness={0.6} />
        </mesh>
      )}
      {/* repère de face */}
      <mesh position={[len * 0.44, topY + 0.001, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[Math.max(0.004, len * 0.035), 3]} />
        <meshBasicMaterial color={opponent ? MAT.white : colors.primary} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Décor
// ---------------------------------------------------------------------------

function ribbon(pts: [number, number][], w: number, y: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[(i - 1 + n) % n]!;
    const [bx, by] = pts[(i + 1) % n]!;
    const [px, py] = pts[i]!;
    const tx = bx - ax;
    const ty = by - ay;
    const l = Math.hypot(tx, ty) || 1;
    const nx = -ty / l;
    const ny = tx / l;
    pos.push(px + (nx * w) / 2, y, py + (ny * w) / 2, px - (nx * w) / 2, y, py - (ny * w) / 2);
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function Track({ st, accent }: { st: GroundStatic; accent: string }) {
  const geo = useMemo(() => ribbon(st.track ?? [], st.lineW ?? 0.02, 0.0015), [st.track, st.lineW]);
  useEffect(() => () => geo.dispose(), [geo]);
  const [sx, sy] = st.track?.[0] ?? [0, 0];
  const [nx, ny] = st.track?.[1] ?? [1, 0];
  return (
    <>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial color={MAT.black} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[sx, 0.002, sy]} rotation={[-Math.PI / 2, 0, -Math.atan2(ny - sy, nx - sx)]}>
        <planeGeometry args={[(st.lineW ?? 0.02) * 1.5, (st.lineW ?? 0.02) * 5]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </>
  );
}

function Dohyo({ R }: { R: number }) {
  const h = Math.max(0.02, R * 0.05);
  return (
    <group>
      <mesh position-y={h / 2} receiveShadow castShadow>
        <cylinderGeometry args={[R, R, h, 64]} />
        <meshStandardMaterial color={MAT.black} roughness={0.85} />
      </mesh>
      <mesh position-y={h + 0.001} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[R * 0.95, R, 64]} />
        <meshStandardMaterial color={MAT.white} roughness={0.6} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * R * 0.1, h + 0.001, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[R * 0.02, R * 0.2]} />
          <meshStandardMaterial color="#7a4a2a" />
        </mesh>
      ))}
    </group>
  );
}

function Arena({ st, colors }: { st: GroundStatic; colors: SceneColors }) {
  const { obsH } = dims(st);
  const { W, H } = st;
  const tile = W > 4 ? 1 : W > 1.5 ? 0.5 : 0.25;
  const floorBase = st.scenario === "track" ? "#d9d8d2" : MAT.concrete;
  const floor = useConcreteTexture(W, H, tile, floorBase, st.scenario === "track" ? "rgba(0,0,0,0.08)" : "rgba(30,30,30,0.35)");
  const outer = useConcreteTexture(W * 6, H * 6, tile * 2, MAT.concreteDark, "rgba(0,0,0,0.25)");
  const crate = useCrateTexture();
  const hazard = useHazardTexture(colors.warning);
  const wallH = st.scenario === "sumo" ? 0 : obsH * 0.5;
  const wallT = Math.max(0.02, W * 0.008);
  useEffect(() => {
    hazard.repeat.set(Math.max(1, (W / wallH) * 0.5), 1);
  }, [hazard, W, wallH]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[W / 2, -0.002, H / 2]} receiveShadow>
        <planeGeometry args={[W * 6, H * 6]} />
        <meshStandardMaterial map={outer} roughness={0.95} />
      </mesh>
      {st.scenario !== "sumo" && (
        <mesh rotation-x={-Math.PI / 2} position={[W / 2, 0, H / 2]} receiveShadow>
          <planeGeometry args={[W, H]} />
          <meshStandardMaterial map={floor} roughness={0.85} />
        </mesh>
      )}
      {wallH > 0 &&
        (
          [
            [W / 2, -wallT / 2, W + wallT * 2, wallT],
            [W / 2, H + wallT / 2, W + wallT * 2, wallT],
            [-wallT / 2, H / 2, wallT, H],
            [W + wallT / 2, H / 2, wallT, H],
          ] as const
        ).map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, wallH / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[w, wallH, d]} />
            <meshStandardMaterial map={hazard} roughness={0.7} />
          </mesh>
        ))}
      {st.obstacles.map((r, i) => (
        <mesh key={i} position={[r.x + r.w / 2, obsH / 2, r.y + r.h / 2]} castShadow receiveShadow>
          <boxGeometry args={[r.w, obsH, r.h]} />
          <meshStandardMaterial map={crate} roughness={0.85} />
        </mesh>
      ))}
      {st.track && <Track st={st} accent={colors.primary} />}
      {st.ringR && (
        <group position={[W / 2, 0, H / 2]}>
          <Dohyo R={st.ringR} />
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Capteurs : rayons, nuage lidar, points de ligne
// ---------------------------------------------------------------------------

function SensorFx({ st, live, colors }: { st: GroundStatic; live: MutableRefObject<GroundLive | null>; colors: SceneColors }) {
  const { len } = st;
  const { bodyY, plateT, topY, legged, obsH } = dims(st);
  const sensorY = (legged ? bodyY : bodyY + plateT) + Math.max(0.008, len * 0.05);
  const lidarY = topY + Math.max(0.015, len * 0.1);
  const ringY = st.ringR ? Math.max(0.02, st.ringR * 0.05) : 0;

  const MAXP = 12000;
  const pts = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  useEffect(() => () => pts.dispose(), [pts]);
  const mapCount = useRef(0);
  const dots = useRef<THREE.Mesh[]>([]);
  const onMat = useMemo(() => new THREE.MeshBasicMaterial({ color: colors.success }), [colors.success]);
  const offMat = useMemo(() => new THREE.MeshBasicMaterial({ color: MAT.metal }), []);

  useFrame(() => {
    const L = live.current;
    if (!L) return;
    // nuage de points lidar (ajouts uniquement)
    if (L.map.size !== mapCount.current) {
      const attr = pts.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      let i = 0;
      for (const [x, y] of L.map.values()) {
        if (i >= MAXP) break;
        arr[i * 3] = x + L.cell / 2;
        arr[i * 3 + 1] = Math.min(lidarY, obsH * 0.9);
        arr[i * 3 + 2] = y + L.cell / 2;
        i++;
      }
      mapCount.current = L.map.size;
      pts.setDrawRange(0, i);
      attr.needsUpdate = true;
      pts.computeBoundingSphere();
    }
    dots.current.forEach((m, i) => {
      const r = L.lineR[i];
      if (!m) return;
      m.visible = !!r;
      if (r) {
        m.position.set(r.x, ringY + 0.002, r.y);
        m.material = r.on ? onMat : offMat;
      }
    });
  });

  return (
    <>
      <DynamicSegments
        max={16}
        color={colors.warning}
        opacity={0.9}
        fill={(out) => {
          const L = live.current;
          if (!L) return 0;
          L.rays.forEach((r, i) => {
            out.set([r.ox, sensorY + ringY, r.oy, r.ox + Math.cos(r.a) * r.d, sensorY + ringY, r.oy + Math.sin(r.a) * r.d], i * 6);
          });
          return L.rays.length;
        }}
      />
      {st.hasLidar && (
        <>
          <DynamicSegments
            max={400}
            color={colors.signal}
            opacity={0.25}
            fill={(out) => {
              const L = live.current;
              if (!L) return 0;
              const { x, y } = L.me;
              let n = 0;
              for (const s of L.scan) {
                if (n >= 400) break;
                out.set([x, lidarY + ringY, y, x + Math.cos(s.a) * s.d, lidarY + ringY, y + Math.sin(s.a) * s.d], n * 6);
                n++;
              }
              return n;
            }}
          />
          <points geometry={pts} frustumCulled={false}>
            <pointsMaterial color={colors.signal} size={Math.max(0.02, st.W / 160)} sizeAttenuation />
          </points>
        </>
      )}
      {st.hasLine &&
        Array.from({ length: 15 }, (_, i) => (
          <mesh key={i} ref={(m) => void (m && (dots.current[i] = m))} visible={false} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[Math.max(0.003, st.wid * 0.03), 12]} />
          </mesh>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function GroundScene3D({ st, live, camera }: { st: GroundStatic; live: MutableRefObject<GroundLive | null>; camera: CameraMode }) {
  const colors = useSceneColors();
  const { topY } = dims(st);
  const ringY = st.ringR ? Math.max(0.02, st.ringR * 0.05) : 0;
  const mePose = () => {
    const L = live.current;
    return L ? { ...L.me, gait: L.gait } : { x: 0, y: 0, th: 0, v: 0, gait: 0 };
  };
  const oppPose = () => {
    const L = live.current;
    return L?.opp ? { ...L.opp, gait: 0 } : { x: -99, y: -99, th: 0, v: 0, gait: 0 };
  };
  const size = Math.max(st.W, st.H);
  const chaseDist = Math.max(st.len * 4.5, 0.45);
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 50, near: Math.max(0.005, st.len * 0.05), far: size * 20, position: [st.W / 2, size, st.H * 1.2] }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={[MAT.sky]} />
      <fog attach="fog" args={[MAT.sky, size * 1.5, size * 5]} />
      <SceneLights size={size} center={[st.W / 2, st.H / 2]} />
      <Arena st={st} colors={colors} />
      <group position-y={ringY}>
        <RobotModel st={st} pose={mePose} accent={colors.primary} colors={colors} />
        {st.scenario === "sumo" && <RobotModel st={st} pose={oppPose} accent={colors.danger} colors={colors} opponent />}
      </group>
      <SensorFx st={st} live={live} colors={colors} />
      <CameraRig
        mode={camera}
        arena={{ W: st.W, H: st.H }}
        clampToArena={st.scenario !== "sumo"}
        dist={chaseDist}
        height={Math.max(topY * 2.2, chaseDist * 0.55)}
        getTarget={() => {
          const p = mePose();
          return { x: p.x, y: ringY + topY * 0.6, z: p.y, heading: p.th };
        }}
      />
      <ReadySignal />
    </Canvas>
  );
}
