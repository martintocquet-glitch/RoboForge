import { describe, expect, it } from "vitest";
import { armGeom, canLift, tipPos } from "./arm-kinematics";

describe("bras robotique", () => {
  it("bras tendu à l'horizontale : la pince est à la portée maximale", () => {
    const g = armGeom(0.3);
    const p = tipPos(g, { q0: 0, q1: 0, q2: 0 });
    expect(p.x).toBeCloseTo(0.3);
    expect(p.z).toBeCloseTo(0.105 - 0.036);
  });
  it("un objet plus lourd que la charge utile ne se soulève pas", () => {
    expect(canLift(500, 320)).toBe(false);
    expect(canLift(200, 320)).toBe(true);
  });
});
