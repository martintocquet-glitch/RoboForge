import type { RobotType, RobotTypeId } from "./types";

export const ROBOT_TYPES: RobotType[] = [
  { id: "rover2wd", name: "Rover 2 roues", short: "2WD", sim: "ground", motorCount: 2, motorKinds: ["dc", "stepper", "smart-servo"], propulsionKinds: ["wheel"], needsDriver: true, blurb: "Robot à conduite différentielle, idéal pour débuter." },
  { id: "rover4wd", name: "Rover 4x4", short: "4WD", sim: "ground", motorCount: 4, motorKinds: ["dc", "smart-servo"], propulsionKinds: ["wheel"], needsDriver: true, blurb: "Quatre roues motrices pour le tout-terrain." },
  { id: "tracked", name: "Robot à chenilles", short: "TRK", sim: "ground", motorCount: 2, motorKinds: ["dc"], propulsionKinds: ["track"], needsDriver: true, blurb: "Adhérence maximale, franchissement d'obstacles." },
  { id: "mecanum", name: "Robot Mecanum", short: "MEC", sim: "ground", motorCount: 4, motorKinds: ["dc", "stepper", "smart-servo"], propulsionKinds: ["mecanum"], needsDriver: true, blurb: "Déplacement omnidirectionnel, peut glisser de côté." },
  { id: "linefollower", name: "Suiveur de ligne", short: "LFR", sim: "ground", motorCount: 2, motorKinds: ["dc"], propulsionKinds: ["wheel"], needsDriver: true, blurb: "Rapide et léger, suit une piste au sol." },
  { id: "sumo", name: "Robot sumo", short: "SUMO", sim: "ground", motorCount: 2, motorKinds: ["dc"], propulsionKinds: ["wheel", "track"], needsDriver: true, blurb: "Compact et puissant, pousse l'adversaire hors du dohyo." },
  { id: "quadcopter", name: "Drone quadricoptère", short: "QUAD", sim: "drone", motorCount: 4, motorKinds: ["brushless"], propulsionKinds: ["propeller"], needsDriver: true, blurb: "Quatre moteurs brushless, vol stabilisé." },
  { id: "hexacopter", name: "Drone hexacoptère", short: "HEX", sim: "drone", motorCount: 6, motorKinds: ["brushless"], propulsionKinds: ["propeller"], needsDriver: true, blurb: "Six moteurs pour plus de charge et de redondance." },
  { id: "arm", name: "Bras robotique", short: "ARM", sim: "arm", motorCount: 4, motorKinds: ["servo", "smart-servo", "stepper"], propulsionKinds: ["gripper"], needsDriver: false, blurb: "Bras articulé avec pince, pick & place." },
  { id: "hexapod", name: "Hexapode", short: "HEXA", sim: "ground", motorCount: 18, motorKinds: ["servo", "smart-servo"], propulsionKinds: ["leg"], needsDriver: false, blurb: "Six pattes, 18 servos, marche sur tout terrain." },
  { id: "humanoid", name: "Humanoïde", short: "HUM", sim: "ground", motorCount: 17, motorKinds: ["servo", "smart-servo"], propulsionKinds: ["leg"], needsDriver: false, blurb: "Robot bipède à 17 articulations." },
];

export const getRobotType = (id: RobotTypeId) => ROBOT_TYPES.find((t) => t.id === id) ?? ROBOT_TYPES[0]!;
