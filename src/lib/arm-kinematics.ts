// Cinématique du bras robotique (sans React ni three.js).
// Base qui pivote (q0), épaule (q1, depuis l'horizontale), coude (q2, relatif au bras).
// Le poignet garde la pince toujours verticale, pointée vers le bas.

export interface ArmGeom {
  baseH: number; // m : hauteur de l'épaule au-dessus de la table
  L1: number; // m : bras
  L2: number; // m : avant-bras
  tool: number; // m : longueur de la pince sous le poignet
}

export interface Joints {
  q0: number;
  q1: number;
  q2: number;
}

export const JOINT_LIMITS = {
  q0: [-Math.PI, Math.PI],
  q1: [0, (170 * Math.PI) / 180],
  q2: [(-160 * Math.PI) / 180, 0],
} as const;

export function armGeom(reachM: number): ArmGeom {
  return { baseH: reachM * 0.35, L1: reachM * 0.5, L2: reachM * 0.5, tool: reachM * 0.12 };
}

/** Position du bout de la pince : x, y sur la table, z en hauteur (m), base en (0,0). */
export function tipPos(g: ArmGeom, j: Joints) {
  const r = g.L1 * Math.cos(j.q1) + g.L2 * Math.cos(j.q1 + j.q2);
  const z = g.baseH + g.L1 * Math.sin(j.q1) + g.L2 * Math.sin(j.q1 + j.q2) - g.tool;
  return { x: r * Math.cos(j.q0), y: r * Math.sin(j.q0), z, r };
}

/** Un objet peut être soulevé si sa masse ne dépasse pas la charge utile calculée dans l'atelier. */
export function canLift(objMassG: number, payloadG: number) {
  return objMassG <= payloadG;
}

export function clampJoint(k: keyof Joints, v: number) {
  const [lo, hi] = JOINT_LIMITS[k];
  return Math.min(hi, Math.max(lo, v));
}
