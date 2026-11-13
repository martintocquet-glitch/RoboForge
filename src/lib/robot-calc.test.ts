import { describe, expect, it } from "vitest";
import { PRESETS } from "@/data/presets";
import { analyzeBuild, autonomyMinutes, groundSpeedMs, thrustToWeight } from "./robot-calc";

describe("robot physics rules", () => {
  it("ground speed = rpm × π × wheel diameter", () => {
    // 200 tr/min sur roue 65 mm ≈ 0,68 m/s
    expect(groundSpeedMs(200, 65)).toBeCloseTo(0.6807, 3);
  });

  it("autonomy uses 80 % of battery capacity", () => {
    // 2200 mAh à 1,76 A → 60 min
    expect(autonomyMinutes(2200, 1.76)).toBeCloseTo(60, 1);
  });

  it("thrust-to-weight ratio", () => {
    expect(thrustToWeight(3200, 1600)).toBe(2);
  });

  it("every preset is a working robot", () => {
    for (const [id, build] of Object.entries(PRESETS)) {
      const a = analyzeBuild(build);
      const errors = a.issues.filter((i) => i.level === "error").map((i) => i.msg);
      expect(errors, id).toEqual([]);
    }
  });

  it("a drone whose thrust is below its weight cannot fly", () => {
    const a = analyzeBuild({ ...PRESETS.quadcopter, chassis: "holybro-x500", motor: "1104-7500", driver: "esc-4in1-12", battery: "aa-nimh-6", propulsion: "prop-gemfan-2.5" });
    expect(a.thrustRatio).toBeLessThan(1);
    expect(a.canSimulate).toBe(false);
  });

  it("a 4S battery on 6 V TT motors is rejected", () => {
    const a = analyzeBuild({ ...PRESETS.rover2wd, battery: "lipo-4s-1500" });
    expect(a.issues.some((i) => i.level === "error" && i.msg.includes("griller"))).toBe(true);
  });

  it("motors without a driver are rejected", () => {
    const a = analyzeBuild({ ...PRESETS.rover2wd, driver: undefined });
    expect(a.canSimulate).toBe(false);
  });

  it("a lidar on USB needs a Linux board", () => {
    const a = analyzeBuild({ ...PRESETS.rover2wd, sensors: ["rplidar-a1"] });
    expect(a.issues.some((i) => i.level === "error" && i.msg.includes("Linux"))).toBe(true);
  });
});
