import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Info, Play, Plus, RotateCcw, Search, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { PartCard } from "@/components/part-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ALL_PARTS, getPart } from "@/data/catalog";
import { getRobotType, ROBOT_TYPES } from "@/data/robot-types";
import type { Build, Part, RobotType, RobotTypeId } from "@/data/types";
import { setBuild, startFromPreset, useBuild } from "@/lib/build-store";
import { compatibilityForPart } from "@/lib/compatibility";
import { formatDuration, formatMass, formatPrice, partKindLabel } from "@/lib/part-specs";
import { analyzeBuild, type Analysis } from "@/lib/robot-calc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/atelier")({
  head: () => ({
    meta: [
      { title: "Atelier — assemblez votre robot | RoboForge" },
      { name: "description", content: "Choisissez châssis, carte mère, moteurs, driver, batterie et capteurs. Compatibilité, poids, vitesse et autonomie calculés en direct." },
      { property: "og:title", content: "Atelier — assemblez votre robot | RoboForge" },
      { property: "og:description", content: "Assemblez votre robot pièce par pièce et voyez en direct ce qui coince." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Atelier,
});

type SlotKey = "chassis" | "controller" | "motor" | "driver" | "battery" | "propulsion" | "sensors";

function slotLabel(key: SlotKey, t: RobotType): string {
  switch (key) {
    case "chassis":
      return t.sim === "arm" ? "Structure du bras" : "Châssis";
    case "controller":
      return t.sim === "drone" ? "Contrôleur de vol / carte mère" : "Carte mère";
    case "motor":
      return t.sim === "drone" ? "Moteurs" : t.motorKinds.includes("servo") ? "Servomoteurs" : "Moteurs";
    case "driver":
      return t.sim === "drone" ? "ESC (variateurs)" : "Driver moteur";
    case "battery":
      return "Batterie";
    case "propulsion":
      return t.sim === "drone" ? "Hélices" : t.sim === "arm" ? "Pince / effecteur" : t.propulsionKinds.includes("leg") ? "Pattes" : t.propulsionKinds.includes("track") ? "Chenilles / roues" : "Roues";
    case "sensors":
      return "Capteurs";
  }
}

const SLOT_CATEGORY: Record<SlotKey, Part["category"]> = {
  chassis: "chassis",
  controller: "controller",
  motor: "motor",
  driver: "driver",
  battery: "battery",
  propulsion: "propulsion",
  sensors: "sensor",
};

function Atelier() {
  const build = useBuild();
  const type = getRobotType(build.type);
  const analysis = useMemo(() => analyzeBuild(build), [build]);
  const [open, setOpen] = useState<SlotKey | null>(null);

  const slots: SlotKey[] = ["chassis", "controller", "motor", "driver", "battery", "propulsion"];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-tech text-primary">Atelier</p>
          <h1 className="mt-1 text-3xl font-bold">{type.name}</h1>
          <p className="mt-1 text-muted-foreground">{type.blurb}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Type de robot"
            value={build.type}
            onChange={(e) => startFromPreset(e.target.value as RobotTypeId)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {ROBOT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={() => startFromPreset(build.type)}>
            <RotateCcw className="mr-1 h-4 w-4" /> Configuration de départ
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {slots.map((key) => {
            const id = build[key as Exclude<SlotKey, "sensors">];
            const part = getPart(id);
            const optional = key === "driver";
            return (
              <SlotRow
                key={key}
                label={slotLabel(key, type)}
                qty={key === "motor" ? build.motorCount : key === "driver" && analysis.driverQty > 1 ? analysis.driverQty : undefined}
                part={part}
                optional={optional}
                onOpen={() => setOpen(key)}
                onClear={() => setBuild((b) => ({ ...b, [key]: undefined }))}
              />
            );
          })}

          <div className="rounded-md border border-border bg-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="label-tech">Capteurs</div>
                <div className="text-sm text-muted-foreground">
                  {build.sensors.length} / {analysis.parts.chassis?.payloadSlots ?? "—"} emplacements
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setOpen("sensors")}>
                <Plus className="mr-1 h-4 w-4" /> Ajouter
              </Button>
            </div>
            {analysis.parts.sensors.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {analysis.parts.sensors.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded border border-border bg-card px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      <div className="label-tech">{partKindLabel(s)} · {s.iface}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Retirer ${s.name}`}
                      onClick={() => setBuild((b) => ({ ...b, sensors: b.sensors.filter((x) => x !== s.id) }))}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Aucun capteur : le robot ne pourra être piloté qu'à la main.</p>
            )}
          </div>
        </div>

        <aside className="space-y-4 md:sticky md:top-20 md:self-start">
          <StatsPanel a={analysis} />
          <IssuesPanel a={analysis} />
          {analysis.canSimulate ? (
            <Button asChild size="lg" className="w-full shadow-glow">
              <Link to="/simulateur">
                <Play className="mr-1 h-4 w-4" /> Lancer la simulation
              </Link>
            </Button>
          ) : (
            <Button size="lg" className="w-full" disabled>
              Corrigez les erreurs pour simuler
            </Button>
          )}
        </aside>
      </div>

      {open && <PartPicker slot={open} build={build} type={type} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SlotRow({ label, part, qty, optional, onOpen, onClear }: { label: string; part?: Part | undefined; qty?: number | undefined; optional?: boolean; onOpen: () => void; onClear: () => void }) {
  return (
    <div className="flex items-center gap-4 rounded-md border border-border bg-panel p-4">
      <div className="min-w-0 flex-1">
        <div className="label-tech">{label}{optional ? " · facultatif" : ""}</div>
        {part ? (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-base font-semibold">{part.name}</span>
            {qty !== undefined && <span className="font-mono text-sm text-primary">× {qty}</span>}
            <span className="text-xs text-muted-foreground">{part.brand} · {formatPrice(part.price)} · {formatMass(part.mass)}</span>
          </div>
        ) : (
          <div className="mt-0.5 text-sm text-muted-foreground">Aucune pièce choisie</div>
        )}
      </div>
      {part && (
        <button type="button" aria-label={`Retirer ${part.name}`} onClick={onClear} className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
      <Button size="sm" variant={part ? "secondary" : "default"} onClick={onOpen}>
        {part ? "Changer" : "Choisir"}
      </Button>
    </div>
  );
}

function PartPicker({ slot, build, type, onClose }: { slot: SlotKey; build: Build; type: RobotType; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const category = SLOT_CATEGORY[slot];
  const current = slot === "sensors" ? build.sensors : [build[slot]].filter(Boolean);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ALL_PARTS.filter((p) => p.category === category)
      .map((p) => ({ p, compatibility: compatibilityForPart(p, build, slot) }))
      .filter(({ compatibility }) => showAll || compatibility.status !== "incompatible")
      .filter(({ p }) => !needle || `${p.name} ${p.brand} ${p.desc} ${partKindLabel(p)}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const rank = { compatible: 0, warning: 1, incompatible: 2 };
        return rank[a.compatibility.status] - rank[b.compatibility.status] || a.p.price - b.p.price;
      });
  }, [q, showAll, category, slot, build]);

  const choose = (id: string) => {
    if (slot === "sensors") {
      setBuild((b) => ({ ...b, sensors: b.sensors.includes(id) ? b.sensors.filter((x) => x !== id) : [...b.sensors, id] }));
    } else {
      setBuild((b) => ({ ...b, [slot]: id }));
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle className="font-display text-xl">{slotLabel(slot, type)}</DialogTitle>
          <DialogDescription>
            {slot === "sensors" ? "Ajoutez ou retirez autant de capteurs que nécessaire." : `Pièces adaptées à un ${type.name.toLowerCase()}.`}
          </DialogDescription>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-9" />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showAll} onCheckedChange={setShowAll} /> Inclure les pièces incompatibles
            </label>
          </div>
        </DialogHeader>
        <div className="grid flex-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {items.map(({ p, compatibility }) => {
            const selected = current.includes(p.id);
            const note =
              compatibility.status === "incompatible"
                ? `Incompatible · ${compatibility.reasons.join(" ")}`
                : compatibility.status === "warning"
                  ? `À vérifier · ${compatibility.reasons.join(" ")}`
                  : undefined;
            return (
              <PartCard
                key={p.id}
                part={p}
                compact
                selected={selected}
                dimmed={compatibility.status === "incompatible"}
                note={note}
                noteLevel={compatibility.status === "incompatible" ? "error" : "warning"}
                action={
                  <Button size="sm" className="w-full" variant={selected ? "secondary" : "default"} onClick={() => choose(p.id)}>
                    {slot === "sensors"
                      ? selected
                        ? "Retirer"
                        : compatibility.status === "incompatible"
                          ? "Ajouter quand même"
                          : "Ajouter"
                      : selected
                        ? "Sélectionné"
                        : compatibility.status === "incompatible"
                          ? "Choisir quand même"
                          : "Choisir"}
                  </Button>
                }
              />
            );
          })}
          {items.length === 0 && <p className="col-span-full py-10 text-center text-muted-foreground">Aucune pièce trouvée.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | undefined }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="label-tech">{label}</div>
      <div className={cn("font-mono text-base tabular-nums", tone === "ok" && "text-success", tone === "warn" && "text-warning", tone === "bad" && "text-destructive")}>{value}</div>
    </div>
  );
}

function StatsPanel({ a }: { a: Analysis }) {
  const sim = a.type.sim;
  const tone = (v: number, good: number, ok: number) => (v >= good ? "ok" : v >= ok ? "warn" : "bad") as "ok" | "warn" | "bad";
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-card px-3 py-2 font-display text-sm font-semibold">Fiche du robot</div>
      <div className="grid grid-cols-2 gap-px bg-border">
        <Stat label="Masse" value={formatMass(a.massG)} />
        <Stat label="Prix estimé" value={formatPrice(a.priceEur)} />
        {sim === "drone" ? (
          <>
            <Stat label="Poussée / poids" value={a.thrustRatio ? a.thrustRatio.toFixed(2) : "—"} tone={a.thrustRatio ? tone(a.thrustRatio, 2, 1.3) : undefined} />
            <Stat label="Vitesse max" value={a.speedMs ? `${Math.round(a.speedMs * 3.6)} km/h` : "—"} />
          </>
        ) : sim === "arm" ? (
          <>
            <Stat label="Charge utile" value={a.payloadG > 0 ? formatMass(a.payloadG) : "—"} tone={a.payloadG > 0 ? tone(a.payloadG, 200, 50) : "bad"} />
            <Stat label="Vitesse articul." value={a.armSpeedDegS ? `${Math.round(a.armSpeedDegS)} °/s` : "—"} />
          </>
        ) : (
          <>
            <Stat label="Vitesse" value={a.speedMs ? `${a.speedMs.toFixed(2)} m/s` : "—"} />
            <Stat label="Marge de couple" value={a.torqueMargin ? `× ${a.torqueMargin.toFixed(1)}` : "—"} tone={a.torqueMargin ? tone(a.torqueMargin, 2, 1) : undefined} />
            {a.torqueNeedKgcm > 0 && (
              <>
                <Stat label="Couple requis" value={`${a.torqueNeedKgcm.toFixed(2)} kg·cm`} />
                <Stat label="Pente max" value={`${Math.round(a.maxSlopeDeg)}°`} tone={tone(a.maxSlopeDeg, 10, 3)} />
              </>
            )}
            <Stat label="Accélération" value={a.accelMs2 ? `${a.accelMs2.toFixed(1)} m/s²` : "—"} />
            <Stat label="Adhérence" value={a.grip ? `μ ${a.grip.toFixed(2)}` : "—"} />
            <Stat label="Force motrice" value={a.driveForceN ? `${Math.round(a.driveForceN)} N` : "—"} />
            <Stat label="Puissance" value={a.powerW ? `${Math.round(a.powerW)} W` : "—"} />
          </>
        )}
        <Stat label="Autonomie" value={formatDuration(a.autonomyMin)} tone={a.autonomyMin ? tone(a.autonomyMin, sim === "drone" ? 8 : 30, sim === "drone" ? 4 : 10) : undefined} />
        <Stat label="Courant moyen" value={`${a.avgCurrentA.toFixed(1)} A`} />
        <Stat label="Pic de courant" value={`${a.peakCurrentA.toFixed(1)} A`} />
        <Stat label="Broches" value={`${a.pinsUsed} / ${a.pinsAvailable}`} tone={a.pinsAvailable ? (a.pinsUsed <= a.pinsAvailable ? "ok" : "bad") : undefined} />
      </div>
    </div>
  );
}

function IssuesPanel({ a }: { a: Analysis }) {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const issues = [...a.issues].sort((x, y) => order[x.level] - order[y.level]);
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-3 py-2 font-display text-sm font-semibold">Vérifications</div>
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> Tout est compatible.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {issues.map((i, k) => (
            <li key={k} className="flex gap-2 px-3 py-2.5 text-sm">
              {i.level === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : i.level === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-signal" />}
              <span>{i.msg}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
