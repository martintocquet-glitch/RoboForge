export type Category =
  | "controller"
  | "motor"
  | "driver"
  | "battery"
  | "sensor"
  | "propulsion"
  | "chassis";

export type MotorKind = "dc" | "stepper" | "servo" | "smart-servo" | "brushless";
export type SensorKind =
  | "distance"
  | "lidar"
  | "camera"
  | "depth"
  | "imu"
  | "line"
  | "gps"
  | "color"
  | "env"
  | "encoder"
  | "contact"
  | "compass"
  | "force";
export type Iface = "GPIO" | "Analog" | "I2C" | "SPI" | "UART" | "USB" | "CSI";
export type PropulsionKind = "wheel" | "track" | "mecanum" | "propeller" | "leg" | "gripper";
export type SimMode = "ground" | "drone" | "arm";
export type RobotTypeId =
  | "rover2wd"
  | "rover4wd"
  | "tracked"
  | "mecanum"
  | "linefollower"
  | "sumo"
  | "quadcopter"
  | "hexacopter"
  | "arm"
  | "hexapod"
  | "humanoid";

interface Base {
  id: string;
  name: string;
  brand: string;
  mass: number; // grammes
  price: number; // EUR approx.
  desc: string;
}

export interface Controller extends Base {
  category: "controller";
  cpu: string;
  clockMHz: number;
  ram: string;
  vin: [number, number]; // plage d'alimentation (V)
  logicV: 3.3 | 5;
  gpio: number;
  pwm: number;
  adc: number;
  wifi: boolean;
  ble: boolean;
  currentmA: number;
  canRunVision: boolean;
}

export interface Motor extends Base {
  category: "motor";
  kind: MotorKind;
  vNom: number;
  vRange: [number, number];
  rpm: number; // tr/min à vide sous vNom (servos : équivalent vitesse)
  torque: number; // couple de blocage kg·cm
  currentA: number; // courant nominal en charge
  stallA: number;
  thrustG?: number; // brushless : poussée max par moteur avec hélice recommandée
  propIn?: number; // taille d'hélice recommandée (pouces)
}

export interface Driver extends Base {
  category: "driver";
  supports: MotorKind[];
  channels: number;
  vRange: [number, number];
  currentA: number; // par canal, continu
  pinsPerChannel: number;
  iface: Iface | "PWM";
}

export interface Battery extends Base {
  category: "battery";
  chemistry: string;
  voltage: number;
  capacity: number; // mAh
  maxA: number; // décharge max continue
}

export interface Sensor extends Base {
  category: "sensor";
  kind: SensorKind;
  iface: Iface;
  pins: number;
  vRange: [number, number];
  currentmA: number;
  range?: number; // m
  fov?: number; // degrés
  rays?: number; // nb de rayons simulés
  needsVision?: boolean;
}

export interface Propulsion extends Base {
  category: "propulsion";
  kind: PropulsionKind;
  diameter: number; // mm (roue) ou pouces (hélice)
  perMotor: boolean; // masse comptée par moteur
}

export interface Chassis extends Base {
  category: "chassis";
  fits: RobotTypeId[];
  size: [number, number]; // mm (L x l) ou portée du bras
  reach?: number; // bras : portée en mm
  payloadSlots: number;
}

export type Part = Controller | Motor | Driver | Battery | Sensor | Propulsion | Chassis;

export interface RobotType {
  id: RobotTypeId;
  name: string;
  short: string;
  sim: SimMode;
  motorCount: number;
  motorKinds: MotorKind[];
  propulsionKinds: PropulsionKind[];
  needsDriver: boolean;
  blurb: string;
}

export interface Build {
  type: RobotTypeId;
  chassis?: string | undefined;
  controller?: string | undefined;
  motor?: string | undefined;
  motorCount: number;
  driver?: string | undefined;
  battery?: string | undefined;
  propulsion?: string | undefined;
  sensors: string[];
}
