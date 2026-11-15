import { describe, expect, it } from "vitest";
import { getPart } from "@/data/catalog";
import { PRESETS } from "@/data/presets";
import type { Motor, Propulsion } from "@/data/types";
import { builtInReducer, driveModel, G, gripOf, KGCM_TO_NM, torqueNeed, tractionAccel } from "./physics";
import { analyzeBuild } from "./robot-calc";

const motor = (id: string) => getPart<Motor>(id)!;
const wheel = (id: string) => getPart<Propulsion>(id)!;

/** Le « dragster » de 6,94 kg : 4 CIM en prise directe sur roues 130 mm. */
const dragster = () =>
  driveModel({ motor: motor("cim"), count: 4, propulsion: wheel("wheel-130"), massG: 6940 })!;

describe("adhérence pneu / sol", () => {
  it("convertit le couple en N·m", () => {
    expect(KGCM_TO_NM).toBeCloseTo(0.0980665, 6);
    expect(G).toBeCloseTo(9.81, 2);
  });

  it("donne à chaque roue son coefficient d'adhérence", () => {
    expect(gripOf(wheel("wheel-silicone-sumo"))).toBe(1.2);
    expect(gripOf(wheel("wheel-tt-65"))).toBe(0.6);
    expect(gripOf(wheel("track-metal"))).toBe(0.75);
    expect(gripOf(wheel("mecanum-60"))).toBe(0.45);
    expect(gripOf(undefined)).toBe(0);
  });

  it("ne modélise pas les pattes, pinces et hélices comme une roue", () => {
    expect(driveModel({ motor: motor("lx-16a"), count: 17, propulsion: wheel("leg-alu"), massG: 900 })).toBeNull();
    expect(driveModel({ motor: motor("a2212-1000"), count: 4, propulsion: wheel("prop-1045"), massG: 1600 })).toBeNull();
  });
});

describe("réducteur intégré", () => {
  it("lit le ratio indiqué par le fabricant", () => {
    expect(builtInReducer(motor("tt-gear"))).toBe(48);
    expect(builtInReducer(motor("pololu-micro-298"))).toBe(298);
    expect(builtInReducer(motor("faulhaber-2232"))).toBe(43);
    expect(builtInReducer(motor("maxon-dcx22"))).toBe(35);
  });

  it("n'invente pas de réducteur là où il n'y en a pas", () => {
    expect(builtInReducer(motor("cim"))).toBeNull();
    expect(builtInReducer(motor("nema17-42"))).toBeNull();
    expect(builtInReducer(motor("28byj-48"))).toBeNull();
  });
});

describe("force motrice et accélération", () => {
  it(" bride l'accélération du dragster par l'adhérence", () => {
    const d = dragster();
    // F = 4 × (24,6 kg·cm × 0,0981 × 0,9 transmission) / 0,065 m
    expect(d.stallForceN).toBeCloseTo(133.61, 1);
    // a = F/m = 133,61 / 6,94
    expect(d.motorAccel).toBeCloseTo(19.25, 1);
    // a max = μ·g = 0,75 × 9,81
    expect(d.gripAccel).toBeCloseTo(7.3575, 3);
    expect(d.accel).toBeCloseTo(7.3575, 3);
    expect(d.gripLimited).toBe(true);
    // 62 % de la force motrice part en patinage
    expect(d.spinLoss).toBeCloseTo(0.618, 2);
    // P = τ·ω/4 = 2,41 N·m × 558 rad/s
    expect(d.powerW).toBeCloseTo(1346.5, 0);
    expect(d.freeSpeed).toBeCloseTo(36.28, 1);
    expect(d.reducer).toBeNull();
    expect(d.reducerRatio).toBe(10);
  });

  it("laisse le moteur limiter l'accélération quand il est trop faible", () => {
    const d = driveModel({ motor: motor("28byj-48"), count: 2, propulsion: wheel("wheel-tt-65"), massG: 500 })!;
    expect(d.stallForceN).toBeCloseTo(1.847, 2);
    expect(d.motorAccel).toBeCloseTo(3.693, 2);
    expect(d.gripAccel).toBeCloseTo(5.886, 2);
    expect(d.accel).toBeCloseTo(3.693, 2);
    expect(d.gripLimited).toBe(false);
    expect(d.spinLoss).toBe(0);
    expect(d.reducerRatio).toBe(0);
  });

  it("fait chuter la force quand la vitesse monte (P = F·v)", () => {
    const d = dragster();
    expect(tractionAccel(d, 0)).toBeCloseTo(7.3575, 3);
    // à 90 % de la vitesse à vide, il ne reste que 10 % du couple
    expect(tractionAccel(d, d.freeSpeed * 0.9)).toBeCloseTo(1.925, 2);
    expect(tractionAccel(d, d.freeSpeed)).toBe(0);
  });

  it("suit la tension de la batterie", () => {
    const full = dragster();
    const low = driveModel({ motor: motor("cim"), count: 4, propulsion: wheel("wheel-130"), massG: 6940, vScale: 0.5 })!;
    expect(low.stallForceN).toBeCloseTo(full.stallForceN * 0.5, 1);
    expect(low.freeSpeed).toBeCloseTo(full.freeSpeed * 0.5, 1);
  });
});

describe("atelier", () => {
  it("signale un moteur rapide monté sans réducteur", () => {
    const a = analyzeBuild({
      ...PRESETS.rover4wd,
      motor: "cim",
      motorCount: 4,
      driver: "bts7960",
      battery: "lipo-3s-2200",
      propulsion: "wheel-130",
    });
    // LiPo 3S = 11,1 V pour un moteur 12 V : 92,5 % de la vitesse à vide, soit 33,6 m/s
    expect(a.freeSpeedMs).toBeCloseTo(33.56, 1);
    expect(a.reducerRatio).toBe(9);
    expect(a.accelMs2).toBeLessThanOrEqual(a.gripAccelMs2 + 1e-9);
    expect(a.issues.some((i) => i.level === "warning" && i.msg.includes("réducteur"))).toBe(true);
  });

  it("ne réclame pas de réducteur aux montages lents", () => {
    const a = analyzeBuild(PRESETS.rover2wd);
    expect(a.reducerRatio).toBe(0);
    expect(a.accelMs2).toBeGreaterThan(0);
    expect(a.issues.some((i) => i.msg.includes("réducteur"))).toBe(false);
  });
});

describe("modèle de couple requis", () => {
  it("additionne roulement, pente et accélération : τ = F·r / (n·η)", () => {
    const t = torqueNeed({ motor: motor("tt-gear"), count: 2, propulsion: wheel("wheel-tt-65"), massG: 600 })!;
    const r = 0.0325;
    const W = 0.6 * G;
    const k = r / (2 * 0.9) / KGCM_TO_NM;
    expect(t.rollKgcm).toBeCloseTo(W * 0.03 * k, 4);
    expect(t.accelKgcm).toBeCloseTo(0.6 * 0.5 * k, 4);
    const th = (10 * Math.PI) / 180;
    expect(t.needKgcm).toBeCloseTo((W * (0.03 * Math.cos(th) + Math.sin(th)) + 0.6 * 0.5) * k, 4);
    expect(t.margin).toBeCloseTo(t.availKgcm / t.needKgcm, 6);
  });

  it("demande plus de couple aux chenilles qu'aux roues", () => {
    const w = torqueNeed({ motor: motor("tt-gear"), count: 2, propulsion: { ...wheel("wheel-tt-65") }, massG: 800 })!;
    const t = torqueNeed({ motor: motor("tt-gear"), count: 2, propulsion: { ...wheel("wheel-tt-65"), kind: "track" }, massG: 800 })!;
    expect(t.rollKgcm).toBeGreaterThan(w.rollKgcm * 3);
  });

  it("bride la pente max par l'adhérence", () => {
    const t = torqueNeed({ motor: motor("cim"), count: 4, propulsion: wheel("wheel-130"), massG: 3000 })!;
    expect(t.maxSlopeDeg).toBeCloseTo((Math.atan(0.75) * 180) / Math.PI, 3);
  });

  it("détecte un moteur bloqué sur le plat", () => {
    const t = torqueNeed({ motor: motor("tt-gear"), count: 2, propulsion: wheel("wheel-130"), massG: 40000 })!;
    expect(t.stalledOnFlat).toBe(true);
    expect(t.cruiseFactor).toBe(0);
  });
});
