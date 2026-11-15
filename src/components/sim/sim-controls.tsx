import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsDown, ChevronsUp, MoveHorizontal } from "lucide-react";
import type { MutableRefObject, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KeySet = MutableRefObject<Set<string>>;

function PadButton({ keys, k, children, label }: { keys: KeySet; k: string; children: ReactNode; label: string }) {
  const down = () => keys.current.add(k);
  const up = () => keys.current.delete(k);
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      className="flex h-11 w-11 select-none items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors active:bg-primary active:text-primary-foreground"
    >
      {children}
    </button>
  );
}

export function DrivePad({ keys, strafe, vertical, className }: { keys: KeySet; strafe?: boolean; vertical?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-end gap-3", className)}>
      <div className="grid grid-cols-3 gap-1">
        <span />
        <PadButton keys={keys} k="ArrowUp" label="Avancer"><ArrowUp className="h-4 w-4" /></PadButton>
        <span />
        <PadButton keys={keys} k="ArrowLeft" label="Gauche"><ArrowLeft className="h-4 w-4" /></PadButton>
        <PadButton keys={keys} k="ArrowDown" label="Reculer"><ArrowDown className="h-4 w-4" /></PadButton>
        <PadButton keys={keys} k="ArrowRight" label="Droite"><ArrowRight className="h-4 w-4" /></PadButton>
      </div>
      {strafe && (
        <div className="flex flex-col items-center gap-1">
          <span className="label-tech">Glisser</span>
          <div className="flex gap-1">
            <PadButton keys={keys} k="KeyA" label="Glisser à gauche"><MoveHorizontal className="h-4 w-4 -scale-x-100" /></PadButton>
            <PadButton keys={keys} k="KeyE" label="Glisser à droite"><MoveHorizontal className="h-4 w-4" /></PadButton>
          </div>
        </div>
      )}
      {vertical && (
        <div className="flex flex-col gap-1">
          <PadButton keys={keys} k="Space" label="Monter"><ChevronsUp className="h-4 w-4" /></PadButton>
          <PadButton keys={keys} k="KeyC" label="Descendre"><ChevronsDown className="h-4 w-4" /></PadButton>
        </div>
      )}
    </div>
  );
}

export function Telemetry({ items }: { items: { label: string; value: string; tone?: "ok" | "warn" | "bad" | undefined }[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="bg-panel px-3 py-2">
          <div className="label-tech">{it.label}</div>
          <div
            className={cn(
              "font-mono text-sm tabular-nums",
              it.tone === "ok" && "text-success",
              it.tone === "warn" && "text-warning",
              it.tone === "bad" && "text-destructive",
            )}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function useKeyHandlers(keys: KeySet) {
  const handled = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyA", "KeyE", "KeyQ", "KeyD", "KeyC"]);
  return {
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (handled.has(e.code)) {
        e.preventDefault();
        keys.current.add(e.code === "KeyQ" ? "KeyA" : e.code === "KeyD" ? "KeyE" : e.code);
      }
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      keys.current.delete(e.code === "KeyQ" ? "KeyA" : e.code === "KeyD" ? "KeyE" : e.code);
    },
    onBlur: () => keys.current.clear(),
  };
}

export function batteryTone(pct: number): "ok" | "warn" | "bad" {
  return pct > 40 ? "ok" : pct > 15 ? "warn" : "bad";
}
