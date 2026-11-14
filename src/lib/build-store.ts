import { useSyncExternalStore } from "react";
import { PRESETS } from "@/data/presets";
import type { Build, RobotTypeId } from "@/data/types";

// Le robot en cours de construction, partagé entre l'atelier et le simulateur
// et conservé dans le navigateur.
const KEY = "roboforge-build-v1";
const DEFAULT: Build = PRESETS.rover2wd;

let state: Build = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): Build | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<Build>;
  if (!b.type || !(b.type in PRESETS)) return null;
  const base = PRESETS[b.type as RobotTypeId];
  return {
    ...base,
    ...b,
    type: b.type as RobotTypeId,
    motorCount: typeof b.motorCount === "number" ? b.motorCount : base.motorCount,
    sensors: Array.isArray(b.sensors) ? b.sensors.filter((s) => typeof s === "string") : [],
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const parsed = sanitize(JSON.parse(window.localStorage.getItem(KEY) ?? "null"));
    if (parsed) state = parsed;
  } catch {
    /* stockage indisponible */
  }
}

export function setBuild(next: Build | ((b: Build) => Build)) {
  load();
  state = typeof next === "function" ? next(state) : next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* stockage indisponible */
  }
  listeners.forEach((l) => l());
}

export function startFromPreset(type: RobotTypeId) {
  setBuild({ ...PRESETS[type], sensors: [...PRESETS[type].sensors] });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useBuild(): Build {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return state;
    },
    () => DEFAULT,
  );
}
