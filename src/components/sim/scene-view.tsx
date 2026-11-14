// Outils communs pour afficher la scène 3D (chargée à la demande) ou la vue 2D.
import { Component, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { CameraMode, ViewMode } from "./scene-types";

export class Scene3DBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.error("Vue 3D indisponible :", err);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
            value === id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function ViewControls({
  view,
  setView,
  camera,
  setCamera,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  camera: CameraMode;
  setCamera: (c: CameraMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Seg label="Vue" value={view} onChange={setView} options={[["3d", "3D"], ["2d", "2D"]]} />
      {view === "3d" && (
        <Seg
          label="Caméra"
          value={camera}
          onChange={setCamera}
          options={[
            ["chase", "Poursuite"],
            ["orbit", "Libre"],
            ["top", "Dessus"],
          ]}
        />
      )}
    </div>
  );
}

export function SceneMessage({ children }: { children: ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export const CAMERA_HINT: Record<CameraMode, string> = {
  chase: "Caméra de poursuite",
  orbit: "Caméra libre : glissez pour tourner, molette pour zoomer",
  top: "Vue de dessus",
};
