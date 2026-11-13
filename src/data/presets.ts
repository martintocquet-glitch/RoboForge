import type { Build, RobotTypeId } from "./types";

// Configurations de départ fonctionnelles pour chaque type de robot.
export const PRESETS: Record<RobotTypeId, Build> = {
  rover2wd: { type: "rover2wd", chassis: "kit-2wd-acrylic", controller: "arduino-uno-r3", motor: "tt-gear", motorCount: 2, driver: "tb6612fng", battery: "18650-2s", propulsion: "wheel-tt-65", sensors: ["hc-sr04", "mpu6050"] },
  rover4wd: { type: "rover4wd", chassis: "kit-4wd-alu", controller: "esp32-devkitc", motor: "jga25-370", motorCount: 4, driver: "cytron-mdd10a", battery: "lipo-3s-2200", propulsion: "wheel-85", sensors: ["vl53l1x", "bno055", "neo-6m"] },
  tracked: { type: "tracked", chassis: "devastator", controller: "rpi-4b", motor: "jga25-370", motorCount: 2, driver: "cytron-mdd10a", battery: "lipo-3s-2200", propulsion: "track-metal", sensors: ["ld19", "rpi-cam-3", "bno055"] },
  mecanum: { type: "mecanum", chassis: "osoyoo-mecanum", controller: "arduino-mega-2560", motor: "jga25-370", motorCount: 4, driver: "l298n", battery: "lipo-3s-2200", propulsion: "mecanum-60", sensors: ["hc-sr04", "mpu6050"] },
  linefollower: { type: "linefollower", chassis: "3pi-plus", controller: "arduino-nano", motor: "pololu-micro-30", motorCount: 2, driver: "drv8833", battery: "lipo-2s-850", propulsion: "wheel-pololu-32", sensors: ["qtr-8rc"] },
  sumo: { type: "sumo", chassis: "jsumo-500", controller: "arduino-nano", motor: "pololu-micro-298", motorCount: 2, driver: "tb6612fng", battery: "lipo-2s-850", propulsion: "wheel-silicone-sumo", sensors: ["vl53l0x", "tcrt5000"] },
  quadcopter: { type: "quadcopter", chassis: "f450", controller: "pixhawk-6c", motor: "a2212-1000", motorCount: 4, driver: "esc-blheli-30", battery: "lipo-3s-2200", propulsion: "prop-1045", sensors: ["neo-m8n", "bmp280"] },
  hexacopter: { type: "hexacopter", chassis: "tarot-680", controller: "pixhawk-6c", motor: "tmotor-mn3508", motorCount: 6, driver: "hobbywing-xrotor-40", battery: "lipo-6s-10000", propulsion: "prop-tmotor-13", sensors: ["zed-f9p", "bmp280"] },
  arm: { type: "arm", chassis: "so-arm100", controller: "esp32-devkitc", motor: "ds3218", motorCount: 4, driver: "pca9685", battery: "lipo-2s-2200", propulsion: "gripper-alu", sensors: ["fsr402"] },
  hexapod: { type: "hexapod", chassis: "freenove-hexapod", controller: "rpi-4b", motor: "mg996r", motorCount: 18, driver: "pca9685", battery: "lipo-2s-2200", propulsion: "leg-printed", sensors: ["hc-sr04", "mpu6050"] },
  humanoid: { type: "humanoid", chassis: "hiwonder-tonypi", controller: "rpi-4b", motor: "lx-16a", motorCount: 17, driver: "u2d2", battery: "lipo-2s-2200", propulsion: "leg-alu", sensors: ["bno055", "rpi-cam-3"] },
};
