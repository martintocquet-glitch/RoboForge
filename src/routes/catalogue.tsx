import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PartCard } from "@/components/part-card";
import { Input } from "@/components/ui/input";
import { ALL_PARTS, CATEGORY_LABELS } from "@/data/catalog";
import type { Part } from "@/data/types";
import { partKindLabel } from "@/lib/part-specs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/catalogue")({
  head: () => ({
    meta: [
      { title: "Catalogue des composants robotiques — RoboForge" },
      { name: "description", content: "Cartes mères, moteurs, drivers, batteries, capteurs, roues, hélices et châssis réels avec leurs caractéristiques techniques." },
      { property: "og:title", content: "Catalogue des composants robotiques — RoboForge" },
      { property: "og:description", content: "Toutes les pièces disponibles pour construire votre robot, avec leurs fiches techniques." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Catalogue,
});

type Cat = Part["category"] | "all";
type Sort = "name" | "price" | "mass";

function Catalogue() {
  const [cat, setCat] = useState<Cat>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ALL_PARTS.filter((p) => cat === "all" || p.category === cat)
      .filter((p) => !needle || `${p.name} ${p.brand} ${p.desc} ${partKindLabel(p)}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "fr") : sort === "price" ? a.price - b.price : a.mass - b.mass));
  }, [cat, q, sort]);

  const cats: [Cat, string][] = [["all", "Tout"], ...(Object.entries(CATEGORY_LABELS) as [Cat, string][])];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <p className="label-tech text-primary">Catalogue</p>
      <h1 className="mt-1 text-3xl font-bold">Tous les composants</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        {ALL_PARTS.length} pièces de grandes marques, avec les valeurs clés de leur fiche technique. Les prix sont indicatifs.
      </p>

      <div className="sticky top-14 z-30 -mx-4 mt-6 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher : ESP32, Dynamixel, lidar, 3S…" className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Trier par
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-md border border-input bg-background px-2 text-foreground">
              <option value="name">Nom</option>
              <option value="price">Prix</option>
              <option value="mass">Masse</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {cats.map(([id, label]) => {
            const n = id === "all" ? ALL_PARTS.length : ALL_PARTS.filter((p) => p.category === id).length;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setCat(id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-sm transition-colors",
                  cat === id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {label} <span className="font-mono text-xs opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">{list.length} résultat{list.length > 1 ? "s" : ""}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => (
          <PartCard key={p.id} part={p} />
        ))}
      </div>
      {list.length === 0 && <p className="py-16 text-center text-muted-foreground">Aucune pièce ne correspond à votre recherche.</p>}
    </div>
  );
}
