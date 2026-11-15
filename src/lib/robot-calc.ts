import { getPart } from "@/data/catalog";
import { getRobotType } from "@/data/robot-types";
import { channelsNeeded, electricalResources, evaluateCompatibility } from "./compatibility";
import { driveModel, G, gripOf } from "./physics";
import type {
  Battery,
  Build,
  Chassis,
  Controller,
  Driver,
  Motor,
  Propulsion,
  RobotType,
  Sensor,
} from "@/data/types";

export type IssueLevel = "error" | "warning" | "info";
export interface Issue {
  level: IssueLevel;
  msg: string;
}

export { channelsNeeded, motorsPerDriverChannel } from "./compatibility";

export interface Analysis {
  type: RobotType;
  parts: {
    chassis?: Chassis | undefined;
    controller?: Controller | undefined;
    motor?: Motor | undefined;
    driver?: Driver | undefined;
    battery?: Battery | undefined;
    propulsion?: Propulsion | undefined;
    sensors: Sensor[];
  };
  issues: Issue[];
  massG: number;
  priceEur: number;
  driverQty: number;
  pinsUsed: number;
  pinsAvailable: number;
  avgCurrentA: number;
  peakCurrentA: number;
  autonomyMin: number;
  speedMs: number;
  thrustRatio: number;
  payloadG: number;
  armSpeedDegS: number;
  torqueMargin: number;
  /** Accélération réellement disponible au départ : min(F/m, μ·g) en m/s². */
  accelMs2: number;
  /** Accélération que le moteur demande sans la limite d'adhérence (m/s²). */
  motorAccelMs2: number;
  /** Force de traction au blocage des roues (N). */
  driveForceN: number;
  /** Puissance mécanique max des moteurs (W). */
  powerW: number;
  /** Vitesse à vide au sol (m/s). */
  freeSpeedMs: number;
  /** Coefficient d'adhérence pneu/sol. */
  grip: number;
  /** Accélération max transmise au sol : μ·g (m/s²). */
  gripAccelMs2: number;
  /** Réducteur déjà intégré au moteur, null si aucun n'est indiqué. */
  reducer: number | null;
  /** Ratio de réducteur à ajouter, 0 si inutile. */
  reducerRatio: number;
  canSimulate: boolean;
}

const BUCK_MASS = 15;
const UBEC_MASS = 20;

export function groundSpeedMs(rpm: number, wheelDiameterMm: number, efficiency = 1): number {
  return ((rpm * Math.PI * wheelDiameterMm) / 60000) * efficiency;
}

export function autonomyMinutes(capacitymAh: number, avgCurrentA: number): number {
  if (avgCurrentA <= 0) return 0;
  // 80 % de la capacité est réellement exploitable
  return ((capacitymAh * 0.8) / 1000 / avgCurrentA) * 60;
}

export function thrustToWeight(thrustG: number, massG: number): number {
  return massG > 0 ? thrustG / massG : 0;
}

export function analyzeBuild(build: Build): Analysis {
  const type = getRobotType(build.type);
  const chassis = getPart<Chassis>(build.chassis);
  const controller = getPart<Controller>(build.controller);
  const motor = getPart<Motor>(build.motor);
  const driver = getPart<Driver>(build.driver);
  const battery = getPart<Battery>(build.battery);
  const propulsion = getPart<Propulsion>(build.propulsion);
  const sensors = build.sensors.map((id) => getPart<Sensor>(id)).filter(Boolean) as Sensor[];
  const count = Math.max(1, build.motorCount || type.motorCount);

  const issues: Issue[] = [];
  const err = (msg: string) => issues.push({ level: "error", msg });
  const warn = (msg: string) => issues.push({ level: "warning", msg });
  const info = (msg: string) => issues.push({ level: "info", msg });
  for (const issue of evaluateCompatibility(build)) {
    if (issue.code === "driver-required") continue;
    if (issue.level === "error") err(issue.message);
    else if (issue.level === "warning") warn(issue.message);
    else info(issue.message);
  }

  if (!chassis) err("Choisissez un châssis.");
  if (!controller) err("Choisissez une carte mère.");
  if (!motor) err("Choisissez un moteur.");
  if (!battery) err("Choisissez une batterie.");
  if (!propulsion) err(type.sim === "drone" ? "Choisissez des hélices." : type.sim === "arm" ? "Choisissez un effecteur (pince)." : type.propulsionKinds.includes("leg") ? "Choisissez des segments de pattes." : "Choisissez des roues ou chenilles.");

  // ----- Driver -----
  let driverQty = 0;
  let extraMass = 0;
  const opencrDynamixel = controller?.id === "opencr" && motor?.kind === "smart-servo";
  const servoDirect = motor?.kind === "servo" && !driver;
  if (motor) {
    const needDriver = !(servoDirect && controller && controller.pwm >= count) && !opencrDynamixel;
    if (motor.kind === "servo" && !driver && controller && controller.pwm < count) {
      err(`${count} servos mais seulement ${controller.pwm} sorties PWM : ajoutez un PCA9685.`);
    } else if (needDriver && !driver) {
      err(motor.kind === "brushless" ? "Ajoutez un ESC pour piloter les moteurs brushless." : motor.kind === "smart-servo" ? "Ajoutez une interface Dynamixel (U2D2) ou une carte OpenCR." : "Ajoutez un driver moteur : une carte ne peut pas alimenter un moteur directement.");
    }
    if (driver) {
      if (driver.supports.includes(motor.kind)) {
        const needed = channelsNeeded(type, motor, count);
        driverQty = Math.ceil(needed / driver.channels);
        if (driverQty > 1) info(`${driverQty} × ${driver.name} nécessaires pour ${needed} canaux.`);
      }
    }
  }

  // ----- Régulateurs requis -----
  if (battery && motor) {
    if (motor.kind === "servo" && battery.voltage > motor.vRange[1]) {
      extraMass += UBEC_MASS;
      info(`Un régulateur UBEC ${motor.vNom} V est ajouté pour les servos.`);
    }
  }
  if (battery && controller) {
    if (battery.voltage > controller.vin[1]) {
      extraMass += BUCK_MASS;
    }
  }

  // ----- Broches -----
  const { pinsUsed, pinsAvailable } = electricalResources(build);

  // ----- Masse & prix -----
  const propCount = propulsion?.perMotor ? count : 1;
  const parts = [chassis, controller, battery];
  let massG = parts.reduce((a, p) => a + (p?.mass ?? 0), 0);
  let priceEur = parts.reduce((a, p) => a + (p?.price ?? 0), 0);
  massG += (motor?.mass ?? 0) * count + (driver?.mass ?? 0) * driverQty + (propulsion?.mass ?? 0) * propCount;
  priceEur += (motor?.price ?? 0) * count + (driver?.price ?? 0) * driverQty + (propulsion?.price ?? 0) * propCount;
  for (const s of sensors) {
    massG += s.mass;
    priceEur += s.price;
  }
  massG += extraMass;
  massG = Math.round(massG * 1.05); // câbles, visserie

  // ----- Courants -----
  const electronicsA = ((controller?.currentmA ?? 0) + sensors.reduce((a, s) => a + s.currentmA, 0)) / 1000;
  let avgCurrentA = electronicsA;
  let peakCurrentA = electronicsA;
  let speedMs = 0;
  let thrustRatio = 0;
  let payloadG = 0;
  let armSpeedDegS = 0;
  let torqueMargin = 0;
  // Adhérence pneu/sol : elle bride l'accélération et la force de poussée.
  const grip = gripOf(propulsion);
  const gripAccelMs2 = grip * G;
  let accelMs2 = 0;
  let motorAccelMs2 = 0;
  let driveForceN = 0;
  let powerW = 0;
  let freeSpeedMs = 0;
  let reducerRatio = 0;
  let reducer: number | null = null;

  if (motor && battery) {
    const vRatio = Math.min(1.25, battery.voltage / motor.vNom) - (driver?.id === "l298n" ? 2 / motor.vNom : 0);
    const effRpm = motor.kind === "dc" ? motor.rpm * Math.max(0, vRatio) : motor.rpm;

    if (type.sim === "drone") {
      let propFactor = 1;
      if (propulsion && motor.propIn) {
        const diff = propulsion.diameter - motor.propIn;
        if (diff < -1.5) {
          propFactor = 0.6;
        }
      }
      const thrust = (motor.thrustG ?? 0) * count * propFactor;
      thrustRatio = thrustToWeight(thrust, massG);
      const throttle = Math.min(1, thrustRatio > 0 ? 1 / thrustRatio : 1);
      avgCurrentA += count * motor.stallA * Math.pow(throttle, 1.5);
      peakCurrentA += count * motor.stallA;
      speedMs = thrustRatio > 1 ? Math.min(40, 9 * Math.sqrt(thrustRatio - 1)) : 0;
      if (thrustRatio < 1) err(`Poussée insuffisante : ${Math.round(thrust)} g pour ${massG} g. Le drone ne décollera pas.`);
      else if (thrustRatio < 1.6) warn(`Rapport poussée/poids de ${thrustRatio.toFixed(2)} : vol lourd et instable (visez ≥ 2).`);
      torqueMargin = thrustRatio;
    } else if (type.sim === "arm") {
      const reachCm = (chassis?.reach ?? 200) / 10;
      const armMassKg = ((chassis?.mass ?? 0) * 0.5 + motor.mass * (count - 1) + (propulsion?.mass ?? 0)) / 1000;
      const selfTorque = armMassKg * (reachCm / 2);
      payloadG = Math.max(0, ((motor.torque * 0.8 - selfTorque) / reachCm) * 1000);
      torqueMargin = selfTorque > 0 ? (motor.torque * 0.8) / selfTorque : 0;
      armSpeedDegS = motor.rpm * 6;
      avgCurrentA += count * motor.currentA * 0.5;
      peakCurrentA += count * motor.stallA * 0.6;
      if (payloadG <= 0) err(`Couple insuffisant : l'épaule a besoin de ${selfTorque.toFixed(1)} kg·cm, ${motor.name} n'en donne que ${motor.torque}.`);
      else if (payloadG < 50) warn(`Charge utile très faible (${Math.round(payloadG)} g).`);
    } else if (propulsion?.kind === "leg") {
      const massKg = massG / 1000;
      const need = type.id === "hexapod" ? (massKg * 6) / 3 : massKg * 8 * 0.6;
      torqueMargin = motor.torque / need;
      speedMs = (motor.rpm / 60) * (type.id === "hexapod" ? 0.06 : 0.03) * Math.min(1, torqueMargin / 1.5);
      // Une patte ne pousse pas plus fort que l'adhérence de son appui.
      accelMs2 = Math.min(speedMs * 3 * Math.min(1.5, Math.max(0.4, torqueMargin / 2)), gripAccelMs2 || Infinity);
      avgCurrentA += count * motor.currentA * 0.6;
      peakCurrentA += count * motor.stallA * 0.5;
      if (torqueMargin < 1) err(`Servos trop faibles : chaque articulation doit fournir ${need.toFixed(1)} kg·cm, ${motor.name} en donne ${motor.torque}. Le robot s'effondre.`);
      else if (torqueMargin < 1.5) warn(`Servos à la limite (marge ×${torqueMargin.toFixed(2)}) : marche lente.`);
    } else {
      const diam = propulsion?.diameter ?? 65;
      const eff = propulsion?.kind === "track" ? 0.8 : propulsion?.kind === "mecanum" ? 0.9 : 1;
      const massKg = massG / 1000;
      const coef = propulsion?.kind === "track" ? 0.4 : 0.25;
      const need = (massKg * (diam / 20) * coef) / count;
      torqueMargin = need > 0 ? motor.torque / need : 0;
      speedMs = groundSpeedMs(effRpm, diam, eff) * (torqueMargin < 1 ? 0 : Math.min(1, 0.6 + torqueMargin * 0.2));
      // Force motrice réelle : couple à la roue / rayon, ponte par la tension batterie,
      // puis accélération F/m bridée par l'adhérence μ·g.
      const drive = driveModel({ motor, count, propulsion, massG, vScale: vRatio });
      if (drive) {
        accelMs2 = drive.accel;
        motorAccelMs2 = drive.motorAccel;
        driveForceN = drive.stallForceN;
        powerW = drive.powerW;
        freeSpeedMs = drive.freeSpeed;
        reducerRatio = drive.reducerRatio;
        reducer = drive.reducer;
        if (drive.gripLimited) {
          info(
            `Adhérence : le sol ne peut transmettre que ${drive.gripAccel.toFixed(1)} m/s² (μ = ${drive.grip}). ` +
              `Le moteur en demande ${drive.motorAccel.toFixed(1)} : ${Math.round(drive.spinLoss * 100)} % de la force part en patinage.`,
          );
        }
        if (drive.reducerRatio > 0) {
          const kmh = Math.round(drive.freeSpeed * 3.6);
          warn(
            drive.reducer === null
              ? `Moteur rapide monté sans réducteur : ${drive.freeSpeed.toFixed(1)} m/s (${kmh} km/h) en sortie moteur. ` +
                  `Ajoutez un réducteur ${drive.reducerRatio}:1 : vitesse ramenée à ${(drive.freeSpeed / drive.reducerRatio).toFixed(1)} m/s et couple multiplié par ${drive.reducerRatio}.`
              : `Réducteur ${drive.reducer}:1 insuffisant : il reste ${drive.freeSpeed.toFixed(1)} m/s (${kmh} km/h). ` +
                  `Ajoutez ${drive.reducerRatio}:1 de plus (total ${Math.round(drive.reducer * drive.reducerRatio)}:1) pour rester pilotable.`,
          );
        }
        const battW = battery.voltage * battery.maxA;
        if (battW < drive.powerW) {
          warn(
            `Puissance : les moteurs peuvent demander ${Math.round(drive.powerW)} W (P = τ·ω), ` +
              `${battery.name} n'en fournit que ${Math.round(battW)} W (${battery.voltage} V × ${battery.maxA} A) : la vitesse max ne sera pas atteinte.`,
          );
        }
      }
      avgCurrentA += count * motor.currentA * 0.6;
      peakCurrentA += count * motor.stallA;
      if (torqueMargin < 1) err(`Couple insuffisant : ${need.toFixed(2)} kg·cm requis par moteur, ${motor.name} donne ${motor.torque}. Le robot ne bouge pas.`);
      else if (torqueMargin < 2) warn(`Marge de couple faible (×${torqueMargin.toFixed(1)}) : accélérations molles.`);
      if (speedMs > 4 && reducerRatio === 0) warn(`Vitesse de ${speedMs.toFixed(1)} m/s : difficile à contrôler en intérieur.`);
    }
  }

  const autonomyMin = battery ? autonomyMinutes(battery.capacity, avgCurrentA) : 0;

  return {
    type,
    parts: { chassis, controller, motor, driver, battery, propulsion, sensors },
    issues,
    massG,
    priceEur: Math.round(priceEur),
    driverQty,
    pinsUsed,
    pinsAvailable,
    avgCurrentA,
    peakCurrentA,
    autonomyMin,
    speedMs,
    thrustRatio,
    payloadG,
    armSpeedDegS,
    torqueMargin,
    accelMs2,
    motorAccelMs2,
    driveForceN,
    powerW,
    freeSpeedMs,
    grip,
    gripAccelMs2,
    reducer,
    reducerRatio,
    canSimulate: !issues.some((i) => i.level === "error"),
  };
}

export const GRAVITY = G;
