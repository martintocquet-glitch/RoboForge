import { describe, expect, it } from "vitest";
import {
  BATTERIES,
  CONTROLLERS,
  DRIVERS,
  MOTORS,
  PROPULSION,
  SENSORS,
  CHASSIS,
  getPart,
} from "@/data/catalog";
import { PRESETS } from "@/data/presets";
import { compatibilityForPart, evaluateCompatibility } from "./compatibility";

describe("component compatibility", () => {
  it("includes new components in all seven catalog categories", () => {
    expect(CONTROLLERS.map((part) => part.id)).toContain("arduino-giga-r1");
    expect(MOTORS.map((part) => part.id)).toContain("pololu-25d-47");
    expect(DRIVERS.map((part) => part.id)).toContain("cytron-mdds30");
    expect(BATTERIES.map((part) => part.id)).toContain("lipo-4s-5000");
    expect(SENSORS.map((part) => part.id)).toContain("bno085");
    expect(PROPULSION.map((part) => part.id)).toContain("prop-gemfan-7");
    expect(CHASSIS.map((part) => part.id)).toContain("rev-duo-ftc");
  });

  it("rejects a motor and driver with different motor types", () => {
    const build = { ...PRESETS.rover2wd, motor: "dynamixel-ax12a" };
    const result = compatibilityForPart(getPart("tb6612fng")!, build, "driver");
    expect(result.status).toBe("incompatible");
    expect(result.reasons.join(" ")).toContain("ne pilote pas");
  });

  it("filters drivers that cannot control any motor for the selected robot type", () => {
    const build = { ...PRESETS.rover2wd, motor: undefined, driver: undefined };
    const result = compatibilityForPart(getPart("esc-blheli-30")!, build, "driver");
    expect(result.status).toBe("incompatible");
  });

  it("shows a battery overvoltage conflict before it is selected", () => {
    const result = compatibilityForPart(getPart("lipo-4s-1500")!, PRESETS.rover2wd, "battery");
    expect(result.status).toBe("incompatible");
    expect(result.reasons.join(" ")).toContain("griller");
  });

  it("warns when a controller needs a voltage converter", () => {
    const build = {
      ...PRESETS.rover2wd,
      controller: "esp32-devkitc",
      motor: "jga25-370",
      driver: "cytron-mdd10a",
    };
    const result = compatibilityForPart(getPart("vex-v5-bat")!, build, "battery");
    expect(result.status).toBe("warning");
    expect(result.reasons.join(" ")).toContain("convertisseur");
  });

  it("detects GPIO exhaustion across sensors and motor drivers", () => {
    const build = {
      ...PRESETS.rover2wd,
      sensors: ["qtrx-hd-15", "qtr-8rc", "hc-sr04"],
    };
    const issues = evaluateCompatibility(build);
    expect(issues.some((issue) => issue.code === "gpio-capacity" && issue.level === "error")).toBe(
      true,
    );
  });

  it("retains a compatible baseline for every robot preset", () => {
    for (const [id, build] of Object.entries(PRESETS)) {
      const errors = evaluateCompatibility(build).filter((issue) => issue.level === "error");
      expect(errors, id).toEqual([]);
    }
  });
});
