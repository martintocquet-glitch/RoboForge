import { getRobotType } from "@/data/robot-types";
import type { MotorKind, Part, PropulsionKind, SensorKind } from "@/data/types";

export const MOTOR_KIND_LABEL: Record<MotorKind, string> = {
  dc: "Courant continu",
  stepper: "Pas à pas",
  servo: "Servo",
  "smart-servo": "Servo intelligent",
  brushless: "Brushless",
};

export const SENSOR_KIND_LABEL: Record<SensorKind, string> = {
  distance: "Distance",
  lidar: "LiDAR",
  camera: "Caméra",
  depth: "Caméra 3D",
  imu: "Centrale inertielle",
  line: "Ligne",
  gps: "GPS",
  color: "Couleur",
  env: "Environnement",
  encoder: "Encodeur",
  contact: "Contact",
  compass: "Boussole",
  force: "Force",
};

export const PROPULSION_KIND_LABEL: Record<PropulsionKind, string> = {
  wheel: "Roue",
  track: "Chenille",
  mecanum: "Mecanum",
  propeller: "Hélice",
  leg: "Patte",
  gripper: "Pince",
};

const range = (r: [number, number], unit: string) => (r[0] === r[1] ? `${r[0]} ${unit}` : `${r[0]}–${r[1]} ${unit}`);

export function partKindLabel(p: Part): string {
  switch (p.category) {
    case "motor":
      return MOTOR_KIND_LABEL[p.kind];
    case "sensor":
      return SENSOR_KIND_LABEL[p.kind];
    case "propulsion":
      return PROPULSION_KIND_LABEL[p.kind];
    default:
      return "";
  }
}

/** Caractéristiques clés d'une pièce, sous forme [libellé, valeur]. */
export function partSpecs(p: Part): [string, string][] {
  switch (p.category) {
    case "controller":
      return [
        ["Processeur", `${p.cpu} · ${p.clockMHz} MHz`],
        ["Alimentation", range(p.vin, "V")],
        ["Broches", `${p.gpio} E/S · ${p.pwm} PWM · ${p.adc} analog.`],
        ["Logique", `${p.logicV} V`],
        ["Sans fil", [p.wifi && "WiFi", p.ble && "Bluetooth"].filter(Boolean).join(" + ") || "Aucun"],
        ["Vision / IA", p.canRunVision ? "Oui" : "Non"],
      ];
    case "motor":
      return [
        ["Type", MOTOR_KIND_LABEL[p.kind]],
        ["Tension", `${p.vNom} V (${range(p.vRange, "V")})`],
        ["Vitesse", `${p.rpm} tr/min`],
        ["Couple", `${p.torque} kg·cm`],
        ["Courant", `${p.currentA} A · blocage ${p.stallA} A`],
        ...(p.thrustG ? ([["Poussée", `${p.thrustG} g · hélice ${p.propIn}"`]] as [string, string][]) : []),
      ];
    case "driver":
      return [
        ["Pilote", p.supports.map((k) => MOTOR_KIND_LABEL[k]).join(", ")],
        ["Canaux", String(p.channels)],
        ["Tension", range(p.vRange, "V")],
        ["Courant", `${p.currentA} A / canal`],
        ["Liaison", p.iface],
      ];
    case "battery":
      return [
        ["Chimie", p.chemistry],
        ["Tension", `${p.voltage} V`],
        ["Capacité", `${p.capacity} mAh`],
        ["Décharge max", `${p.maxA} A`],
      ];
    case "sensor":
      return [
        ["Type", SENSOR_KIND_LABEL[p.kind]],
        ["Liaison", p.iface],
        ["Alimentation", range(p.vRange, "V")],
        ["Conso", `${p.currentmA} mA`],
        ...(p.range ? ([["Portée", `${p.range} m`]] as [string, string][]) : []),
        ...(p.fov ? ([["Champ", `${p.fov}°`]] as [string, string][]) : []),
      ];
    case "propulsion":
      return [
        ["Type", PROPULSION_KIND_LABEL[p.kind]],
        ...(p.diameter ? ([["Diamètre", p.kind === "propeller" ? `${p.diameter}"` : `${p.diameter} mm`]] as [string, string][]) : []),
        ["Masse", p.perMotor ? `${p.mass} g par moteur` : `${p.mass} g`],
      ];
    case "chassis":
      return [
        ["Pour", p.fits.map((t) => getRobotType(t).name).join(", ")],
        [p.reach ? "Portée" : "Taille", p.reach ? `${p.reach} mm` : `${p.size[0]} × ${p.size[1]} mm`],
        ["Emplacements", `${p.payloadSlots} capteurs`],
      ];
  }
}

export function formatPrice(eur: number) {
  return `${eur.toLocaleString("fr-FR", { maximumFractionDigits: eur < 10 ? 1 : 0 })} €`;
}

export function formatMass(g: number) {
  return g >= 1000 ? `${(g / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg` : `${Math.round(g)} g`;
}

export function formatDuration(min: number) {
  if (!isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(Math.round(min % 60)).padStart(2, "0")}`;
}
