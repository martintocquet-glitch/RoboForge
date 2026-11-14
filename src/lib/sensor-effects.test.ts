import { describe, expect, it } from "vitest";
import { getPart } from "@/data/catalog";
import type { Sensor } from "@/data/types";
import { capabilities, driftFor, gasLevel, gpsAccuracyM, gpsOffset, imuProfile, loadFactor } from "@/lib/sensor-effects";

const S = (...ids: string[]) => ids.map((id) => getPart<Sensor>(id)!);

describe("IMU et boussole", () => {
  it("sans centrale, la dérive de cap est totale", () => {
    expect(imuProfile(S("hc-sr04"))).toMatchObject({ level: 0, driftDamping: 0, headingLock: false });
    expect(driftFor(0)).toEqual({ slip: 0.22, wander: 0.06 });
  });

  it("une IMU six axes retire 70 % de la dérive sans verrouiller le cap", () => {
    expect(imuProfile(S("mpu6050"))).toMatchObject({ level: 1, driftDamping: 0.7, headingLock: false });
    expect(driftFor(0.7).slip).toBeCloseTo(0.066, 10);
    expect(driftFor(0.7).wander).toBeCloseTo(0.018, 10);
  });

  it("une IMU neuf axes verrouille le cap", () => {
    expect(imuProfile(S("bno055"))).toMatchObject({ level: 2, driftDamping: 0.9, headingLock: true });
    expect(imuProfile(S("icm20948")).level).toBe(2);
    expect(imuProfile(S("bmi270")).level).toBe(1);
  });

  it("une boussole seule donne déjà un cap absolu", () => {
    expect(imuProfile(S("hmc5883l"))).toMatchObject({ compass: true, driftDamping: 0.85, headingLock: true });
    expect(imuProfile(S("mpu6050", "hmc5883l")).driftDamping).toBe(0.98);
  });
});

describe("GPS : le prix change la précision", () => {
  it("chaque module a son erreur propre", () => {
    expect(gpsAccuracyM(S("neo-6m"))).toBe(2.5);
    expect(gpsAccuracyM(S("neo-m8n"))).toBe(1.5);
    expect(gpsAccuracyM(S("zed-f9p"))).toBe(0.02);
  });

  it("sans GPS il n'y a aucune position", () => {
    expect(gpsAccuracyM(S("mpu6050"))).toBeNull();
  });

  it("le meilleur module monté décide de la précision", () => {
    expect(gpsAccuracyM(S("neo-6m", "zed-f9p"))).toBe(0.02);
  });

  it("le bruit reste de l'ordre de l'erreur annoncée", () => {
    expect(gpsOffset(2.5, () => 0.5)).toEqual([0, 0]);
    expect(Math.abs(gpsOffset(0.02, () => 1)[0])).toBeLessThan(0.1);
    expect(Math.abs(gpsOffset(2.5, () => 1)[0])).toBeGreaterThan(1);
  });
});

describe("Encodeurs : la vitesse tient sous charge", () => {
  it("sans encodeurs le poids et ce qu'on poussent font chuter la vitesse", () => {
    expect(loadFactor(1200, false, false)).toBeCloseTo(0.8, 5);
    expect(loadFactor(1200, true, false)).toBeCloseTo(0.4, 5);
  });

  it("avec encodeurs l'asservissement rattrape la perte", () => {
    expect(loadFactor(1200, false, true)).toBeCloseTo(0.97, 5);
    expect(loadFactor(1200, true, true)).toBeCloseTo(0.91, 5);
    expect(capabilities(S("hall-encoder")).encoders).toBe(true);
    expect(capabilities(S("as5600")).encoders).toBe(true);
    expect(capabilities(S("mpu6050")).encoders).toBe(false);
  });
});

describe("Pare-chocs, gaz, couleur", () => {
  it("un micro-rupteur déclenche le réflexe de choc", () => {
    expect(capabilities(S("microswitch")).bumper).toBe(true);
    expect(capabilities(S("hc-sr04")).bumper).toBe(false);
  });

  it("seul le MQ-2 et le BME680 sentent le gaz", () => {
    expect(capabilities(S("mq2")).gas).toBe(true);
    expect(capabilities(S("bme680")).gas).toBe(true);
    expect(capabilities(S("bmp280")).gas).toBe(false);
    expect(capabilities(S("dht22")).gas).toBe(false);
    expect(capabilities(S("bmp280")).temp).toBe(true);
  });

  it("la concentration de gaz dépend de la distance au nuage", () => {
    const cloud = { x: 4, y: 3, r: 2 };
    expect(gasLevel(4, 3, cloud)).toBe(1);
    expect(gasLevel(5, 3, cloud)).toBe(0.5);
    expect(gasLevel(10, 3, cloud)).toBe(0);
  });

  it("une caméra IA voit les couleurs de loin, le capteur de couleur de très près", () => {
    expect(capabilities(S("tcs34725"))).toMatchObject({ color: true, colorRange: 0.35 });
    expect(capabilities(S("pixy2"))).toMatchObject({ color: true, colorRange: 3 });
    expect(capabilities(S("huskylens"))).toMatchObject({ color: true, colorRange: 3 });
    expect(capabilities(S("rpi-cam-3")).color).toBe(false);
    expect(capabilities(S("hc-sr04")).color).toBe(false);
  });

  it("les capteurs de force ne servent encore à rien au sol", () => {
    expect(capabilities(S("fsr402", "hx711-load"))).toMatchObject({
      bumper: false,
      encoders: false,
      gas: false,
      color: false,
      gpsAcc: null,
    });
  });
});
