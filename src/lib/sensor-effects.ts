// Ce que chaque capteur change réellement dans la simulation.
// Un capteur purement décoratif n'apparaît dans aucune de ces fonctions : il ne doit
// donc rien modifier au comportement du robot, seulement peser et consommer.
import type { Sensor } from "@/data/types";

export interface ImuProfile {
  /** 0 = aucune centrale, 1 = six axes, 2 = neuf axes (fusion embarquée). */
  level: 0 | 1 | 2;
  /** Boussole : le cap est rapporté au Nord, pas seulement aux roues. */
  compass: boolean;
  /** 0..1 : part de la dérive de cap supprimée par la centrale. */
  driftDamping: number;
  /** Le contrôleur recalle le cap en permanence au lieu de le suivre à l'aveugle. */
  headingLock: boolean;
}

// Seuls ces capteurs-là sentent un gaz ; le baromètre et le thermomètre non.
const GAS_IDS = new Set(["mq2", "bme680"]);
const TEMP_IDS = new Set(["bmp280", "bme680", "dht22"]);

export function imuProfile(sensors: Sensor[]): ImuProfile {
  const imus = sensors.filter((s) => s.kind === "imu");
  const level: 0 | 1 | 2 = imus.some((s) => s.axes === 9) ? 2 : imus.some((s) => s.axes === 6) ? 1 : 0;
  const compass = sensors.some((s) => s.kind === "compass");
  let driftDamping = level === 2 ? 0.9 : level === 1 ? 0.7 : 0;
  if (compass) driftDamping = level > 0 ? 0.98 : 0.85;
  return { level, compass, driftDamping, headingLock: level === 2 || compass };
}

/** Patinage des roues dans les virages et dérive lente du cap, selon la centrale montée. */
export function driftFor(damping: number): { slip: number; wander: number } {
  return { slip: 0.22 * (1 - damping), wander: 0.06 * (1 - damping) };
}

/**
 * Vitesse réellement disponible sous charge.
 * Sans encodeurs, rien ne corrige : le poids et ce que le robot poussent font chuter la vitesse.
 * Avec encodeurs, la boucle d'asservissement rattrape l'essentiel de la perte.
 */
export function loadFactor(massG: number, pushing: boolean, encoders: boolean): number {
  const raw = Math.min(0.35, massG / 6000) + (pushing ? 0.4 : 0);
  return 1 - raw * (encoders ? 0.15 : 1);
}

/** Erreur de position du GPS, en mètres (la meilleure des deux antennes montées). */
export function gpsAccuracyM(sensors: Sensor[]): number | null {
  const gps = sensors.filter((s) => s.kind === "gps");
  return gps.length ? Math.min(...gps.map((s) => s.accuracy ?? 2.5)) : null;
}

/** Déplacement erratique de la position perçue, d'écart-type `accuracy`. */
export function gpsOffset(accuracy: number, rnd: () => number = Math.random): [number, number] {
  const g = () => (rnd() + rnd() + rnd() - 1.5) * 2;
  return [g() * accuracy, g() * accuracy];
}

/** Concentration de gaz lue en un point : 1 au centre du nuage, 0 hors du nuage. */
export function gasLevel(px: number, py: number, cloud: { x: number; y: number; r: number }): number {
  return Math.max(0, 1 - Math.hypot(px - cloud.x, py - cloud.y) / cloud.r);
}

export interface Capabilities {
  imu: ImuProfile;
  encoders: boolean;
  bumper: boolean;
  gas: boolean;
  temp: boolean;
  /** Capteur de couleur ou caméra IA : le robot sait distinguer une cible colorée. */
  color: boolean;
  /** Distance à laquelle une cible colorée est reconnue (m). */
  colorRange: number;
  gpsAcc: number | null;
}

export function capabilities(sensors: Sensor[]): Capabilities {
  const colorSensors = sensors.filter((s) => s.kind === "color" || s.aiVision === true);
  return {
    imu: imuProfile(sensors),
    encoders: sensors.some((s) => s.kind === "encoder"),
    bumper: sensors.some((s) => s.kind === "contact"),
    gas: sensors.some((s) => s.kind === "env" && GAS_IDS.has(s.id)),
    temp: sensors.some((s) => s.kind === "env" && TEMP_IDS.has(s.id)),
    color: colorSensors.length > 0,
    colorRange: colorSensors.reduce((a, s) => Math.max(a, s.range ?? 0.35), 0),
    gpsAcc: gpsAccuracyM(sensors),
  };
}
