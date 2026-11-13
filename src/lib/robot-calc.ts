import { getPart } from "@/data/catalog";
import { getRobotType } from "@/data/robot-types";
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

export interface Analysis {
  type: RobotType;
  parts: {
    chassis?: Chassis;
    controller?: Controller;
    motor?: Motor;
    driver?: Driver;
    battery?: Battery;
    propulsion?: Propulsion;
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
  canSimulate: boolean;
}

const G = 9.81;
const BUCK_MASS = 15;
const UBEC_MASS = 20;

export function motorsPerDriverChannel(type: RobotType): number {
  // Les rovers 4 roues et chenilles câblent les moteurs d'un même côté en parallèle.
  if (type.id === "rover4wd") return 2;
  return 1;
}

export function channelsNeeded(type: RobotType, motor: Motor, count: number): number {
  if (motor.kind === "smart-servo") return 1;
  if (motor.kind === "dc" && type.id === "rover4wd") return 2;
  return count;
}

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

  if (!chassis) err("Choisissez un châssis.");
  if (!controller) err("Choisissez une carte mère.");
  if (!motor) err("Choisissez un moteur.");
  if (!battery) err("Choisissez une batterie.");
  if (!propulsion) err(type.sim === "drone" ? "Choisissez des hélices." : type.sim === "arm" ? "Choisissez un effecteur (pince)." : type.propulsionKinds.includes("leg") ? "Choisissez des segments de pattes." : "Choisissez des roues ou chenilles.");

  if (chassis && !chassis.fits.includes(type.id)) err(`Le châssis ${chassis.name} n'est pas prévu pour un ${type.name.toLowerCase()}.`);
  if (motor && !type.motorKinds.includes(motor.kind)) err(`Un moteur de type « ${motor.kind} » ne convient pas à un ${type.name.toLowerCase()}.`);
  if (propulsion && !type.propulsionKinds.includes(propulsion.kind)) err(`${propulsion.name} ne convient pas à ce type de robot.`);

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
      if (!driver.supports.includes(motor.kind)) {
        err(`${driver.name} ne pilote pas ce type de moteur (${motor.kind}).`);
      } else {
        const needed = channelsNeeded(type, motor, count);
        driverQty = Math.ceil(needed / driver.channels);
        if (driverQty > 1) info(`${driverQty} × ${driver.name} nécessaires pour ${needed} canaux.`);
        const perChannel = motor.currentA * (motor.kind === "smart-servo" ? count * 0.5 : motorsPerDriverChannel(type));
        const stallPerChannel = motor.stallA * (motor.kind === "smart-servo" ? count * 0.3 : motorsPerDriverChannel(type));
        if (motor.kind === "servo") {
          // Les servos sont alimentés par le rail de puissance, le PCA9685 ne fournit que le signal.
        } else if (perChannel > driver.currentA) err(`Driver surchargé : ${perChannel.toFixed(1)} A par canal pour ${driver.currentA} A max.`);
        else if (stallPerChannel > driver.currentA * 1.5) warn(`Au blocage, les moteurs tirent ${stallPerChannel.toFixed(1)} A : le driver risque de chauffer.`);
      }
    }
  }

  // ----- Tensions -----
  if (battery && motor) {
    const v = battery.voltage;
    const [lo, hi] = motor.vRange;
    if (motor.kind === "servo" && v > hi) {
      extraMass += UBEC_MASS;
      info(`Un régulateur UBEC ${motor.vNom} V est ajouté pour les servos.`);
    } else if (v > hi * 1.25) err(`Batterie ${v} V trop forte pour ${motor.name} (${hi} V max) : le moteur va griller.`);
    else if (v > hi) warn(`Batterie ${v} V légèrement au-dessus du maximum moteur (${hi} V).`);
    else if (v < lo * 0.85) err(`Batterie ${v} V trop faible pour ${motor.name} (${lo} V min).`);
    else if (v < lo) warn(`Batterie ${v} V un peu faible pour ${motor.name}.`);
  }
  if (battery && driver && !driver.supports.includes("servo")) {
    if (battery.voltage > driver.vRange[1]) err(`${driver.name} accepte ${driver.vRange[1]} V max (batterie ${battery.voltage} V).`);
    else if (battery.voltage < driver.vRange[0]) warn(`${driver.name} demande au moins ${driver.vRange[0]} V.`);
  }
  if (battery && controller) {
    if (battery.voltage > controller.vin[1]) {
      extraMass += BUCK_MASS;
      info(`Un convertisseur abaisseur est ajouté pour alimenter ${controller.name}.`);
    } else if (battery.voltage < controller.vin[0]) err(`${controller.name} demande au moins ${controller.vin[0]} V (batterie ${battery.voltage} V).`);
  }

  // ----- Capteurs & broches -----
  let pinsUsed = 0;
  let i2c = false;
  for (const s of sensors) {
    if (s.iface === "I2C") i2c = true;
    else pinsUsed += s.pins;
    if ((s.iface === "USB" || s.iface === "CSI" || s.needsVision) && controller && !controller.canRunVision) {
      err(`${s.name} demande une carte Linux (Raspberry Pi, Jetson…), pas ${controller.name}.`);
    }
    if (controller && (s.iface === "GPIO" || s.iface === "Analog") && (controller.logicV < s.vRange[0] || controller.logicV > s.vRange[1])) {
      warn(`${s.name} fonctionne en ${s.vRange[0]}–${s.vRange[1]} V : ajoutez un convertisseur de niveau (${controller.logicV} V).`);
    }
  }
  if (driver && driverQty > 0 && motor) {
    if (driver.iface === "I2C") i2c = true;
    else pinsUsed += Math.min(channelsNeeded(type, motor, count), driver.channels * driverQty) * Math.max(1, driver.pinsPerChannel);
  } else if (servoDirect) pinsUsed += count;
  if (i2c) pinsUsed += 2;
  const pinsAvailable = controller?.gpio ?? 0;
  if (controller && pinsUsed > pinsAvailable) err(`Pas assez de broches : ${pinsUsed} utilisées pour ${pinsAvailable} disponibles.`);

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

  if (chassis && sensors.length > chassis.payloadSlots) warn(`Châssis chargé : ${sensors.length} capteurs pour ${chassis.payloadSlots} emplacements.`);

  // ----- Courants -----
  const electronicsA = ((controller?.currentmA ?? 0) + sensors.reduce((a, s) => a + s.currentmA, 0)) / 1000;
  let avgCurrentA = electronicsA;
  let peakCurrentA = electronicsA;
  let speedMs = 0;
  let thrustRatio = 0;
  let payloadG = 0;
  let armSpeedDegS = 0;
  let torqueMargin = 0;

  if (motor && battery) {
    const vRatio = Math.min(1.25, battery.voltage / motor.vNom) - (driver?.id === "l298n" ? 2 / motor.vNom : 0);
    const effRpm = motor.kind === "dc" ? motor.rpm * Math.max(0, vRatio) : motor.rpm;

    if (type.sim === "drone") {
      let propFactor = 1;
      if (propulsion && motor.propIn) {
        const diff = propulsion.diameter - motor.propIn;
        if (diff > 1.5) err(`Hélices ${propulsion.diameter}" trop grandes pour ${motor.name} (${motor.propIn}" conseillé) : surchauffe moteur.`);
        else if (diff < -1.5) {
          propFactor = 0.6;
          warn(`Hélices ${propulsion.diameter}" trop petites (${motor.propIn}" conseillé) : poussée réduite.`);
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
      avgCurrentA += count * motor.currentA * 0.6;
      peakCurrentA += count * motor.stallA;
      if (torqueMargin < 1) err(`Couple insuffisant : ${need.toFixed(2)} kg·cm requis par moteur, ${motor.name} donne ${motor.torque}. Le robot ne bouge pas.`);
      else if (torqueMargin < 2) warn(`Marge de couple faible (×${torqueMargin.toFixed(1)}) : accélérations molles.`);
      if (speedMs > 4) warn(`Vitesse de ${speedMs.toFixed(1)} m/s : difficile à contrôler en intérieur.`);
    }
  }

  if (battery) {
    if (peakCurrentA > battery.maxA) {
      if (avgCurrentA > battery.maxA) err(`${battery.name} ne peut fournir que ${battery.maxA} A (besoin ${avgCurrentA.toFixed(1)} A).`);
      else warn(`Pics de courant (${peakCurrentA.toFixed(1)} A) au-dessus de la limite batterie (${battery.maxA} A).`);
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
    canSimulate: !issues.some((i) => i.level === "error"),
  };
}

export const GRAVITY = G;
