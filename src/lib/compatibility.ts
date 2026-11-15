import { getPart } from "@/data/catalog";
import { getRobotType } from "@/data/robot-types";
import type {
  Battery,
  Build,
  Chassis,
  Controller,
  Driver,
  Motor,
  Part,
  Propulsion,
  RobotType,
  Sensor,
} from "@/data/types";

export interface CompatibilityIssue {
  code: string;
  level: "error" | "warning" | "info";
  message: string;
  partIds: string[];
}

export type CompatibilityStatus = "compatible" | "warning" | "incompatible";

export interface PartCompatibility {
  status: CompatibilityStatus;
  reasons: string[];
}

export function motorsPerDriverChannel(type: RobotType): number {
  // Les rovers 4 roues câblent les moteurs d'un même côté en parallèle.
  return type.id === "rover4wd" ? 2 : 1;
}

export function channelsNeeded(type: RobotType, motor: Motor, count: number): number {
  if (motor.kind === "smart-servo") return 1;
  if (motor.kind === "dc" && type.id === "rover4wd") return 2;
  return count;
}

export interface ElectricalResources {
  pinsUsed: number;
  pinsAvailable: number;
  adcUsed: number;
  adcAvailable: number;
  pwmUsed: number;
  pwmAvailable: number;
}

/** Estime les broches réellement nécessaires à la carte choisie. */
export function electricalResources(build: Build): ElectricalResources {
  const type = getRobotType(build.type);
  const controller = getPart<Controller>(build.controller);
  const motor = getPart<Motor>(build.motor);
  const driver = getPart<Driver>(build.driver);
  const sensors = build.sensors
    .map((id) => getPart<Sensor>(id))
    .filter((part): part is Sensor => Boolean(part));
  const count = Math.max(1, build.motorCount || type.motorCount);
  const needed = motor ? channelsNeeded(type, motor, count) : count;
  const driverQty =
    driver && motor && driver.supports.includes(motor.kind)
      ? Math.ceil(needed / driver.channels)
      : 0;

  let pinsUsed = 0;
  let adcUsed = 0;
  let pwmUsed = 0;
  let i2cUsed = false;

  for (const sensor of sensors) {
    if (sensor.iface === "I2C") i2cUsed = true;
    else if (sensor.iface === "USB" || sensor.iface === "CSI") continue;
    else {
      pinsUsed += sensor.pins;
      if (sensor.iface === "Analog") adcUsed += sensor.pins;
    }
  }

  if (driver && motor && driverQty > 0) {
    if (driver.iface === "I2C") i2cUsed = true;
    else if (driver.iface !== "USB" && driver.iface !== "CSI") {
      const channels = Math.min(needed, driver.channels * driverQty);
      pinsUsed += channels * driver.pinsPerChannel;
      if (driver.iface === "PWM") pwmUsed += channels;
    }
  } else if (motor?.kind === "servo") {
    pwmUsed += count;
    pinsUsed += count;
  }

  if (i2cUsed) pinsUsed += 2;

  return {
    pinsUsed,
    pinsAvailable: controller?.gpio ?? 0,
    adcUsed,
    adcAvailable: controller?.adc ?? 0,
    pwmUsed,
    pwmAvailable: controller?.pwm ?? 0,
  };
}

/** Vérifie les contraintes électriques et mécaniques d'une configuration complète. */
export function evaluateCompatibility(build: Build): CompatibilityIssue[] {
  const type = getRobotType(build.type);
  const chassis = getPart<Chassis>(build.chassis);
  const controller = getPart<Controller>(build.controller);
  const motor = getPart<Motor>(build.motor);
  const driver = getPart<Driver>(build.driver);
  const battery = getPart<Battery>(build.battery);
  const propulsion = getPart<Propulsion>(build.propulsion);
  const sensors = build.sensors
    .map((id) => getPart<Sensor>(id))
    .filter((part): part is Sensor => Boolean(part));
  const count = Math.max(1, build.motorCount || type.motorCount);
  const issues: CompatibilityIssue[] = [];

  const add = (
    code: string,
    level: CompatibilityIssue["level"],
    message: string,
    ...partIds: (string | undefined)[]
  ) => {
    issues.push({
      code,
      level,
      message,
      partIds: [...new Set(partIds.filter((id): id is string => Boolean(id)))],
    });
  };

  if (chassis && !chassis.fits.includes(type.id)) {
    add(
      "chassis-type",
      "error",
      `${chassis.name} n'est pas prévu pour un ${type.name.toLowerCase()}.`,
      chassis.id,
    );
  }
  if (motor && !type.motorKinds.includes(motor.kind)) {
    add(
      "motor-type",
      "error",
      `${motor.name} ne convient pas à un ${type.name.toLowerCase()}.`,
      motor.id,
    );
  }
  if (propulsion && !type.propulsionKinds.includes(propulsion.kind)) {
    add(
      "propulsion-type",
      "error",
      `${propulsion.name} ne convient pas à ce type de robot.`,
      propulsion.id,
    );
  }

  if (motor && battery) {
    const [minV, maxV] = motor.vRange;
    if (motor.kind === "servo" && (battery.voltage < minV || battery.voltage > maxV)) {
      add(
        "motor-voltage",
        "warning",
        `Un régulateur UBEC réglé à ${motor.vNom} V est nécessaire pour ${motor.name}.`,
        motor.id,
        battery.id,
      );
    } else if (battery.voltage > maxV * 1.25) {
      add(
        "motor-voltage",
        "error",
        `${battery.name} (${battery.voltage} V) dépasse la limite de ${motor.name} (${maxV} V) : le moteur risque de griller.`,
        motor.id,
        battery.id,
      );
    } else if (battery.voltage > maxV) {
      add(
        "motor-voltage",
        "warning",
        `${battery.name} dépasse légèrement la tension maximale de ${motor.name} (${maxV} V).`,
        motor.id,
        battery.id,
      );
    } else if (battery.voltage < minV * 0.85) {
      add(
        "motor-voltage",
        "error",
        `${battery.name} est trop faible pour ${motor.name} (minimum ${minV} V).`,
        motor.id,
        battery.id,
      );
    } else if (battery.voltage < minV) {
      add(
        "motor-voltage",
        "warning",
        `${battery.name} est légèrement sous la tension minimale de ${motor.name} (${minV} V).`,
        motor.id,
        battery.id,
      );
    }
  }

  if (motor) {
    const directServo = motor.kind === "servo" && !driver;
    const opencrServo = controller?.id === "opencr" && motor.kind === "smart-servo";
    if (!driver && !directServo && !opencrServo) {
      add(
        "driver-required",
        "warning",
        motor.kind === "brushless"
          ? "Nécessite un ESC compatible."
          : motor.kind === "smart-servo"
            ? "Nécessite une interface de bus servo ou une carte OpenCR."
            : "Nécessite un driver moteur compatible.",
        motor.id,
      );
    }
    if (directServo && controller && controller.pwm < count) {
      add(
        "servo-pwm",
        "error",
        `${count} servos demandent ${count} sorties PWM ; ${controller.name} n'en offre que ${controller.pwm}.`,
        motor.id,
        controller.id,
      );
    }
    if (driver && !driver.supports.includes(motor.kind)) {
      add(
        "driver-motor-kind",
        "error",
        `${driver.name} ne pilote pas les moteurs de type « ${motor.kind} ».`,
        driver.id,
        motor.id,
      );
    } else if (driver) {
      const needed = channelsNeeded(type, motor, count);
      const driverQty = Math.ceil(needed / driver.channels);
      const perChannel =
        motor.currentA *
        (motor.kind === "smart-servo" ? count * 0.5 : motorsPerDriverChannel(type));
      const stallPerChannel =
        motor.stallA * (motor.kind === "smart-servo" ? count * 0.3 : motorsPerDriverChannel(type));
      if (motor.kind !== "servo" && perChannel > driver.currentA) {
        add(
          "driver-current",
          "error",
          `Le courant moteur (${perChannel.toFixed(1)} A par canal) dépasse la limite de ${driver.name} (${driver.currentA} A).`,
          driver.id,
          motor.id,
        );
      } else if (motor.kind !== "servo" && stallPerChannel > driver.currentA * 1.5) {
        add(
          "driver-stall-current",
          "warning",
          `Au blocage, les moteurs peuvent demander ${stallPerChannel.toFixed(1)} A par canal ; ${driver.name} risque de chauffer.`,
          driver.id,
          motor.id,
        );
      }
      if (driver.iface === "USB" && controller && !controller.canRunVision && !opencrServo) {
        add(
          "driver-host",
          "error",
          `${driver.name} demande une carte hôte compatible USB, pas ${controller.name}.`,
          driver.id,
          controller.id,
        );
      }
    }
  } else if (driver && !driver.supports.some((kind) => type.motorKinds.includes(kind))) {
    add(
      "driver-type",
      "error",
      `${driver.name} ne pilote aucun moteur prévu pour un ${type.name.toLowerCase()}.`,
      driver.id,
    );
  }

  if (
    battery &&
    driver &&
    motor &&
    driver.supports.includes(motor.kind) &&
    motor.kind !== "servo"
  ) {
    if (battery.voltage > driver.vRange[1]) {
      add(
        "driver-voltage",
        "error",
        `${driver.name} accepte ${driver.vRange[1]} V maximum, mais ${battery.name} fournit ${battery.voltage} V.`,
        driver.id,
        battery.id,
      );
    } else if (battery.voltage < driver.vRange[0]) {
      add(
        "driver-voltage",
        "warning",
        `${driver.name} demande au moins ${driver.vRange[0]} V.`,
        driver.id,
        battery.id,
      );
    }
  }

  if (battery && controller) {
    if (battery.voltage < controller.vin[0]) {
      add(
        "controller-voltage",
        "error",
        `${controller.name} demande au moins ${controller.vin[0]} V, mais la batterie fournit ${battery.voltage} V.`,
        controller.id,
        battery.id,
      );
    } else if (battery.voltage > controller.vin[1]) {
      add(
        "controller-voltage",
        "warning",
        `Un convertisseur abaisseur est nécessaire pour alimenter ${controller.name} avec ${battery.voltage} V.`,
        controller.id,
        battery.id,
      );
    }
  }

  if (motor && propulsion?.kind === "propeller" && motor.propIn) {
    const difference = propulsion.diameter - motor.propIn;
    if (difference > 1.5) {
      add(
        "propeller-size",
        "error",
        `Les hélices ${propulsion.diameter}" sont trop grandes pour ${motor.name} (${motor.propIn}" conseillé).`,
        motor.id,
        propulsion.id,
      );
    } else if (difference < -1.5) {
      add(
        "propeller-size",
        "warning",
        `Ces hélices sont plus petites que les ${motor.propIn}" conseillés pour ${motor.name} ; la poussée sera réduite.`,
        motor.id,
        propulsion.id,
      );
    }
  }

  for (const sensor of sensors) {
    if (
      (sensor.iface === "USB" || sensor.iface === "CSI" || sensor.needsVision) &&
      controller &&
      !controller.canRunVision
    ) {
      add(
        "sensor-host",
        "error",
        `${sensor.name} demande une carte Linux (Raspberry Pi, Jetson…), pas ${controller.name}.`,
        sensor.id,
        controller.id,
      );
    }
    if (
      (sensor.iface === "GPIO" || sensor.iface === "Analog") &&
      controller &&
      (controller.logicV < sensor.vRange[0] || controller.logicV > sensor.vRange[1])
    ) {
      add(
        "sensor-voltage",
        "warning",
        `${sensor.name} utilise une logique ${sensor.vRange[0]}–${sensor.vRange[1]} V ; un convertisseur de niveau peut être nécessaire avec ${controller.logicV} V.`,
        sensor.id,
        controller.id,
      );
    }
  }

  if (chassis && sensors.length > chassis.payloadSlots) {
    add(
      "chassis-capacity",
      "warning",
      `${sensors.length} capteurs dépassent les ${chassis.payloadSlots} emplacements de ${chassis.name}.`,
      chassis.id,
      ...sensors.map((sensor) => sensor.id),
    );
  }

  const resources = electricalResources(build);
  if (controller && resources.pinsUsed > resources.pinsAvailable) {
    add(
      "gpio-capacity",
      "error",
      `${controller.name} manque de broches : ${resources.pinsUsed} utilisées pour ${resources.pinsAvailable} disponibles.`,
      controller.id,
      driver?.id,
      ...sensors.map((sensor) => sensor.id),
    );
  }
  if (controller && resources.adcUsed > resources.adcAvailable) {
    add(
      "adc-capacity",
      "error",
      `${controller.name} manque d'entrées analogiques : ${resources.adcUsed} utilisées pour ${resources.adcAvailable} disponibles.`,
      controller.id,
      ...sensors.filter((sensor) => sensor.iface === "Analog").map((sensor) => sensor.id),
    );
  }
  if (controller && resources.pwmUsed > resources.pwmAvailable) {
    add(
      "pwm-capacity",
      "error",
      `${controller.name} manque de sorties PWM : ${resources.pwmUsed} nécessaires pour ${resources.pwmAvailable} disponibles.`,
      controller.id,
      driver?.id,
      motor?.id,
    );
  }

  if (battery) {
    const electronicsA =
      ((controller?.currentmA ?? 0) +
        sensors.reduce((total, sensor) => total + sensor.currentmA, 0)) /
      1000;
    let averageMotorA = 0;
    let peakMotorA = 0;
    if (motor) {
      if (type.sim === "drone") {
        const propulsionCount = propulsion?.perMotor ? count : 1;
        const validDriverQty =
          driver && driver.supports.includes(motor.kind)
            ? Math.ceil(channelsNeeded(type, motor, count) / driver.channels)
            : 0;
        const regulatorMass =
          (motor.kind === "servo" && battery.voltage > motor.vRange[1] ? 20 : 0) +
          (controller && battery.voltage > controller.vin[1] ? 15 : 0);
        const massBeforeCabling =
          (chassis?.mass ?? 0) +
          (controller?.mass ?? 0) +
          battery.mass +
          motor.mass * count +
          (driver?.mass ?? 0) * validDriverQty +
          (propulsion?.mass ?? 0) * propulsionCount +
          sensors.reduce((total, sensor) => total + sensor.mass, 0) +
          regulatorMass;
        const thrustRatio =
          massBeforeCabling > 0 ? ((motor.thrustG ?? 0) * count) / (massBeforeCabling * 1.05) : 0;
        const throttle = Math.min(1, thrustRatio > 0 ? 1 / thrustRatio : 1);
        averageMotorA = count * motor.stallA * Math.pow(throttle, 1.5);
        peakMotorA = count * motor.stallA;
      } else if (type.sim === "arm") {
        averageMotorA = count * motor.currentA * 0.5;
        peakMotorA = count * motor.stallA * 0.6;
      } else {
        averageMotorA = count * motor.currentA * 0.6;
        peakMotorA = count * motor.stallA * (propulsion?.kind === "leg" ? 0.5 : 1);
      }
    }
    const averageA = electronicsA + averageMotorA;
    const peakA = electronicsA + peakMotorA;
    if (averageA > battery.maxA) {
      add(
        "battery-current",
        "error",
        `${battery.name} ne peut fournir que ${battery.maxA} A (besoin moyen estimé ${averageA.toFixed(1)} A).`,
        battery.id,
        motor?.id,
      );
    } else if (peakA > battery.maxA) {
      add(
        "battery-current",
        "warning",
        `Les pics estimés (${peakA.toFixed(1)} A) dépassent la limite de ${battery.name} (${battery.maxA} A).`,
        battery.id,
        motor?.id,
      );
    }
  }

  return issues;
}

/** Évalue une pièce candidate en la plaçant dans la configuration courante. */
export function compatibilityForPart(
  part: Part,
  build: Build,
  slot: keyof Build,
): PartCompatibility {
  const candidate: Build =
    slot === "sensors"
      ? {
          ...build,
          sensors: build.sensors.includes(part.id) ? build.sensors : [...build.sensors, part.id],
        }
      : { ...build, [slot]: part.id };
  const relevantIssues = evaluateCompatibility(candidate).filter((issue) =>
    issue.partIds.includes(part.id),
  );
  const status: CompatibilityStatus = relevantIssues.some((issue) => issue.level === "error")
    ? "incompatible"
    : relevantIssues.some((issue) => issue.level === "warning")
      ? "warning"
      : "compatible";
  return { status, reasons: relevantIssues.map((issue) => issue.message) };
}
