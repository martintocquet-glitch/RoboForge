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
 * Résistance au roulement Crr (F = Crr · m · g) : déformation du pneu, friction
 * des roulements et, pour les chenilles et mecanum, frottement interne des
 * maillons ou des galets.
 */
export const ROLLING_RESISTANCE: Record<PropulsionKind, number> = {
  wheel: 0.03,
  track: 0.1,
  mecanum: 0.06,
  leg: 0,
  propeller: 0,
  gripper: 0,
};

/** Cas de dimensionnement : rampe de 10° franchie en accélérant à 0,5 m/s². */
export const DESIGN_SLOPE_DEG = 10;
export const DESIGN_ACCEL = 0.5;

export interface TorqueNeed {
  /** Couple par moteur pour vaincre le roulement sur le plat (kg·cm). */
  rollKgcm: number;
  /** Couple par moteur pour gravir la rampe de dimensionnement (kg·cm). */
  slopeKgcm: number;
  /** Couple par moteur pour accélérer à DESIGN_ACCEL (kg·cm). */
  accelKgcm: number;
  /** Couple total requis par moteur, en sortie moteur (kg·cm). */
  needKgcm: number;
  /** Couple de blocage disponible par moteur à la tension réelle (kg·cm). */
  availKgcm: number;
  /** Couple au-delà duquel la roue patine, par moteur (kg·cm). */
  gripKgcm: number;
  /** Disponible / requis. */
  margin: number;
  /** Vrai si le moteur ne vainc même pas le roulement sur le plat. */
  stalledOnFlat: boolean;
  /** Fraction de la vitesse à vide atteinte en croisière sur le plat. */
  cruiseFactor: number;
  /** Pente maximale franchissable, limitée par le couple puis l'adhérence (°). */
  maxSlopeDeg: number;
}

/**
 * Couple requis à la roue :
 *   F = m·g·(Crr·cos θ + sin θ) + m·a
 *   τ_moteur = F · r / (n · η)
 * Le moteur à courant continu suit τ(ω) = τ_blocage · (1 − ω/ω₀), donc la vitesse
 * de croisière est atteinte quand τ(ω) égale le couple de roulement.
 */
export function torqueNeed(o: {
  motor: Motor;
  count: number;
  propulsion: Propulsion;
  massG: number;
  vScale?: number;
}): TorqueNeed | null {
  const { motor, propulsion } = o;
  const kind = propulsion.kind;
  if (kind === "leg" || kind === "gripper" || kind === "propeller") return null;
  const count = Math.max(1, o.count);
  const massKg = Math.max(0, o.massG) / 1000;
  if (massKg <= 0) return null;
  const vScale = Math.max(0, Math.min(1.25, o.vScale ?? 1));
  const r = Math.max(0.005, propulsion.diameter / 2000);
  const eta = TRANS_EFF[kind] ?? 0.9;
  const crr = ROLLING_RESISTANCE[kind] ?? 0.03;
  const th = (DESIGN_SLOPE_DEG * Math.PI) / 180;
  const W = massKg * G;
  const toKgcm = (forceN: number) => (forceN * r) / (count * eta) / KGCM_TO_NM;

  const rollKgcm = toKgcm(W * crr);
  const slopeKgcm = toKgcm(W * (crr * Math.cos(th) + Math.sin(th))) - rollKgcm;
  const accelKgcm = toKgcm(massKg * DESIGN_ACCEL);
  const needKgcm = rollKgcm + slopeKgcm + accelKgcm;
  const availKgcm = motor.torque * vScale;
  const grip = gripOf(propulsion);
  const gripKgcm = toKgcm(W * grip);

  // Pente max : sin θ + Crr·cos θ = F_dispo / (m·g), puis tan θ ≤ μ.
  const usable = Math.min(availKgcm, gripKgcm);
  const x = (usable * KGCM_TO_NM * count * eta) / r / W;
  const phi = Math.atan(crr);
  const s = x / Math.sqrt(1 + crr * crr);
  const torqueSlope = s >= 1 ? Math.PI / 2 - phi : Math.max(0, Math.asin(Math.max(0, s)) - phi);
  const maxSlopeDeg = (Math.min(torqueSlope, Math.atan(grip)) * 180) / Math.PI;

  return {
    rollKgcm,
    slopeKgcm,
    accelKgcm,
    needKgcm,
    availKgcm,
    gripKgcm,
    margin: needKgcm > 0 ? availKgcm / needKgcm : 0,
    stalledOnFlat: availKgcm <= rollKgcm,
    cruiseFactor: availKgcm > 0 ? Math.max(0, 1 - rollKgcm / availKgcm) : 0,
    maxSlopeDeg,
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
