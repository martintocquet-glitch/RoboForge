// Physique du déplacement : force motrice, accélération et limite d'adhérence.
// Le couple et la vitesse des moteurs du catalogue sont déjà mesurés À LA SORTIE
// du réducteur intégré (c'est ce que les fabricants indiquent), donc le ratio
// trouvé dans le nom du moteur ne sert qu'à prévenir et conseiller, jamais à
// multiplier le couple une seconde fois.
import type { Motor, Propulsion, PropulsionKind } from "@/data/types";

export const G = 9.81;
/** 1 kg·cm de couple = 0,0981 N·m. */
export const KGCM_TO_NM = 0.0980665;
/** Au-delà, un robot n'est plus pilotable en intérieur (m/s ≈ 14 km/h). */
export const SAFE_SPEED = 4;

/** Adhérence de base par famille de propulsion (a max = μ · g). */
const BASE_GRIP: Record<PropulsionKind, number> = {
  wheel: 0.7,
  track: 1.05,
  mecanum: 0.45,
  leg: 0.55,
  propeller: 0,
  gripper: 0,
};

/** Adhérence mesurée pièce par pièce : le caoutchouc mord, le plastique glisse. */
const GRIP_BY_ID: Record<string, number> = {
  "wheel-tt-65": 0.6,
  "wheel-pololu-32": 0.55,
  "wheel-pololu-60": 0.55,
  "wheel-silicone-sumo": 1.2,
  "wheel-85": 0.85,
  "wheel-gobilda-96": 0.95,
  "wheel-130": 0.75,
  "track-t100": 1.0,
  "track-metal": 0.75,
  "mecanum-60": 0.45,
  "mecanum-97": 0.45,
  "gobilda-mecanum-104": 0.5,
  "leg-alu": 0.6,
  "leg-printed": 0.5,
};

/** Pertes entre la sortie du moteur et le sol (chaînes, engrenages, rollers). */
const TRANS_EFF: Record<PropulsionKind, number> = {
  wheel: 0.9,
  track: 0.82,
  mecanum: 0.85,
  leg: 0.9,
  propeller: 1,
  gripper: 1,
};

export function gripOf(propulsion: Propulsion | undefined): number {
  if (!propulsion) return 0;
  return GRIP_BY_ID[propulsion.id] ?? BASE_GRIP[propulsion.kind] ?? 0;
}

/**
 * Réducteur déjà intégré au moteur, quand son nom l'indique (« 1:48 », « 20/1 »,
 * « (43:1) »). Renvoie le plus grand ratio trouvé, ou null si rien n'est indiqué.
 */
export function builtInReducer(motor: Motor): number | null {
  const re = /(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)/g;
  let best: number | null = null;
  for (const m of motor.name.matchAll(re)) {
    const a = Number.parseFloat(m[1]!.replace(",", "."));
    const b = Number.parseFloat(m[2]!.replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    const r = Math.max(a / b, b / a);
    if (r >= 2 && r <= 500 && (best === null || r > best)) best = r;
  }
  return best;
}

export interface Drive {
  /** Rayon de la roue (m). */
  wheelR: number;
  /** Coefficient d'adhérence μ. */
  grip: number;
  /** Accélération max transmise au sol : μ · g (m/s²). */
  gripAccel: number;
  /** Force de traction au blocage des roues, tous moteurs confondus (N). */
  stallForceN: number;
  /** Puissance mécanique max, P = τ · ω / 4 (W). */
  powerW: number;
  /** Vitesse à vide au sol (m/s). */
  freeSpeed: number;
  /** Accélération que le moteur demande : F / m (m/s²). */
  motorAccel: number;
  /** Accélération réellement disponible : min(F/m, μ·g) (m/s²). */
  accel: number;
  /** Vrai si l'adhérence bridée l'accélération demandée par le moteur. */
  gripLimited: boolean;
  /** Part de la force motrice perdue en patinage (0..1). */
  spinLoss: number;
  /** Réducteur déjà intégré, null si le nom n'en indique aucun. */
  reducer: number | null;
  /** Ratio de réducteur supplémentaire à ajouter, 0 si inutile. */
  reducerRatio: number;
}

/**
 * Modèle moteur à courant continu : le couple disponible tombe linéairement
 * quand la vitesse monte, donc F(v) = F_blocage · (1 − v / v_à_vide).
 * L'accélération est ensuite bridée par l'adhérence pneu/sol.
 */
export function driveModel(o: {
  motor: Motor | undefined;
  count: number;
  propulsion: Propulsion | undefined;
  massG: number;
  /** Tension réelle / tension nominale : couple et vitesse à vide suivent la tension. */
  vScale?: number;
}): Drive | null {
  const { motor, propulsion, massG } = o;
  const count = Math.max(1, o.count);
  const vScale = Math.max(0, Math.min(1.25, o.vScale ?? 1));
  if (!motor || !propulsion || massG <= 0 || motor.torque <= 0 || motor.rpm <= 0) return null;
  // Pattes, pinces et hélices ne transmettent pas de couple à une roue.
  if (propulsion.kind === "leg" || propulsion.kind === "gripper" || propulsion.kind === "propeller") return null;

  const wheelR = Math.max(0.005, propulsion.diameter / 2000);
  const grip = gripOf(propulsion);
  const tau = motor.torque * KGCM_TO_NM * vScale * (TRANS_EFF[propulsion.kind] ?? 0.9); // N·m à la roue
  const stallForceN = (tau * count) / wheelR;
  const omega = (motor.rpm * vScale * Math.PI * 2) / 60; // rad/s à la roue
  const freeSpeed = omega * wheelR;
  const powerW = ((motor.torque * KGCM_TO_NM * vScale) * omega * count) / 4;
  const gripAccel = grip * G;
  const motorAccel = stallForceN / (massG / 1000);
  const accel = Math.min(motorAccel, gripAccel);
  const reducer = builtInReducer(motor);
  return {
    wheelR,
    grip,
    gripAccel,
    stallForceN,
    powerW,
    freeSpeed,
    motorAccel,
    accel,
    gripLimited: gripAccel < motorAccel,
    spinLoss: gripAccel < motorAccel ? 1 - gripAccel / motorAccel : 0,
    reducer,
    reducerRatio: freeSpeed > SAFE_SPEED ? Math.ceil(freeSpeed / SAFE_SPEED) : 0,
  };
}

/**
 * Accélération disponible à une vitesse donnée : la force du moteur décroît
 * jusqu'à s'annuler à la vitesse à vide, et ne dépasse jamais μ·g.
 */
export function tractionAccel(d: Drive, v: number): number {
  const drop = Math.max(0, 1 - Math.abs(v) / Math.max(0.01, d.freeSpeed));
  return Math.max(0, Math.min(d.gripAccel, d.motorAccel * drop));
}
