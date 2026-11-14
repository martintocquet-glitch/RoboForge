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

export interface GroundStatic {
  scenario: "arena" | "track" | "sumo";
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
  start: { x: number; y: number };
}

export interface DroneLive {
  me: { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number };
  throttle: number;
  rays: { a: number; d: number; r: number }[];
  scan: { a: number; d: number; r: number }[];
  waypoint: [number, number] | null;
  crashed: boolean;
}
