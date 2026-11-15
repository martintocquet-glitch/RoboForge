// État partagé entre la simulation (2D, en TypeScript pur) et la vue 3D.
// La simulation écrit ces objets à chaque pas ; la scène 3D se contente de les lire.
import type { Rect } from "./sim-utils";

export type ViewMode = "3d" | "2d";
export type CameraMode = "chase" | "orbit" | "top";

export interface Pose {
  x: number;
  y: number;
  th: number;
  v: number;
}

export interface Disc {
  x: number;
  y: number;
  r: number;
}

export interface GroundStatic {
  scenario: "arena" | "track" | "sumo" | "mission";
  W: number;
  H: number;
  obstacles: Rect[];
  track?: [number, number][] | undefined;
  lineW?: number | undefined;
  ringR?: number | undefined;
  len: number;
  wid: number;
  typeId: string;
  propKind: "wheel" | "track" | "mecanum" | "leg" | string;
  wheelD: number;
  wheelPairs: number;
  sensorOffsets: number[]; // angle de chaque capteur de distance (rad, relatif au cap)
  hasLidar: boolean;
  hasLine: boolean;
  hasCamera: boolean;
  hasBumper: boolean;
  hasColor: boolean;
  hasGas: boolean;
  gpsAcc: number | null; // m : erreur de position du GPS monté
  targets: (Disc & { good: boolean })[]; // cibles colorées
  zones: Disc[]; // bandes de freinage rouges sur la piste
  gas?: Disc | undefined; // nuage toxique
}

export interface GroundLive {
  me: Pose;
  opp: Pose | null;
  rays: { ox: number; oy: number; a: number; d: number; r: number }[];
  scan: { a: number; d: number; r: number }[];
  lineR: { x: number; y: number; on: boolean }[];
  map: Map<string, [number, number]>;
  cell: number;
  gait: number;
  fix: { x: number; y: number } | null; // position perçue par le GPS
  gas: number; // concentration lue, 0..1
  bumper: boolean; // appui sur le pare-chocs
  target: [number, number] | null; // objectif en cours (waypoint GPS ou cible colorée)
}

export interface DroneBuilding extends Rect {
  alt: number;
}

export interface DroneStatic {
  W: number;
  H: number;
  ceiling: number;
  buildings: DroneBuilding[];
  span: number;
  motorCount: number;
  hasGps: boolean;
  hasLidar: boolean;
  /** Erreur de position du GPS en m (null = pas de GPS). */
  gpsAcc: number | null;
  start: { x: number; y: number };
}

export interface DroneLive {
  me: { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number };
  throttle: number;
  rays: { a: number; d: number; r: number }[];
  scan: { a: number; d: number; r: number }[];
  waypoint: [number, number] | null;
  crashed: boolean;
  /** Position renvoyée par le GPS (null = pas de GPS). */
  fix: { x: number; y: number } | null;
}

export interface ArmObject {
  id: number;
  x: number;
  y: number;
  z: number; // m : bas de l'objet
  size: number;
  massG: number;
  held: boolean;
  done: boolean;
}

export interface ArmStatic {
  W: number;
  H: number;
  base: { x: number; y: number };
  baseH: number;
  L1: number;
  L2: number;
  tool: number;
  bin: { x: number; y: number; w: number; h: number; depth: number };
  suction: boolean;
}

export interface ArmLive {
  q0: number;
  q1: number;
  q2: number;
  grip: number; // 0 ouvert … 1 fermé
  tip: { x: number; y: number; z: number };
  objects: ArmObject[];
}
