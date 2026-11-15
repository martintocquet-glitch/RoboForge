import type { ReactNode } from "react";
import type { Part } from "@/data/types";
import { formatMass, formatPrice, partKindLabel, partSpecs } from "@/lib/part-specs";
import { cn } from "@/lib/utils";

export function PartCard({
  part,
  selected,
  note,
  compatibilityStatus,
  noteLevel = "warning",
  action,
  compact,
}: {
  part: Part;
  selected?: boolean | undefined;
  note?: string | undefined;
  compatibilityStatus?: "compatible" | "warning" | "incompatible" | undefined;
  noteLevel?: "warning" | "error";
  action?: ReactNode;
  compact?: boolean | undefined;
}) {
  const kind = partKindLabel(part);
  const specs = partSpecs(part);
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-md border bg-card p-4 transition-colors",
        selected ? "border-primary shadow-glow" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="label-tech truncate">
              {part.brand}
              {kind ? ` · ${kind}` : ""}
            </div>
            {compatibilityStatus === "incompatible" && (
              <span className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive">
                Incompatible
              </span>
            )}
            {compatibilityStatus === "warning" && (
              <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-warning">
                À vérifier
              </span>
            )}
          </div>
          <h3 className="mt-0.5 font-display text-base font-semibold leading-snug">{part.name}</h3>
        </div>
        <div className="shrink-0 text-right font-mono text-sm tabular-nums">
          <div>{formatPrice(part.price)}</div>
          <div className="text-xs text-muted-foreground">{formatMass(part.mass)}</div>
        </div>
      </div>
      {!compact && <p className="mt-1.5 text-sm text-muted-foreground">{part.desc}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {specs.slice(0, compact ? 4 : specs.length).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate font-mono" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {note && (
        <p
          className={cn(
            "mt-2 text-xs",
            noteLevel === "error" ? "text-destructive" : "text-warning",
          )}
        >
          {note}
        </p>
      )}
      {action && <div className="mt-auto pt-3">{action}</div>}
    </div>
  );
}
