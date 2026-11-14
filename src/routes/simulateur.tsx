import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { DroneSim } from "@/components/sim/drone-sim";
import { GroundSim } from "@/components/sim/ground-sim";
import { Button } from "@/components/ui/button";
import { useBuild } from "@/lib/build-store";
import { analyzeBuild } from "@/lib/robot-calc";

export const Route = createFileRoute("/simulateur")({
  head: () => ({
    meta: [
      { title: "Simulateur — pilotez votre robot | RoboForge" },
      { name: "description", content: "Pilotez le robot assemblé dans l'atelier : arène d'obstacles, suivi de ligne, combat de sumo." },
      { property: "og:title", content: "Simulateur — pilotez votre robot | RoboForge" },
      { property: "og:description", content: "Testez votre robot en simulation avec ses vraies caractéristiques." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Simulateur,
});

function Simulateur() {
  const build = useBuild();
  const analysis = useMemo(() => analyzeBuild(build), [build]);
  const { type } = analysis;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-tech text-primary">Simulateur</p>
          <h1 className="mt-1 text-3xl font-bold">{type.name}</h1>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to="/atelier">Modifier dans l'atelier</Link>
        </Button>
      </div>
      <div className="mt-6">
        {!analysis.canSimulate ? (
          <div className="rounded-md border border-border bg-panel p-6">
            <p className="font-semibold">Ce robot ne peut pas encore être simulé.</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
              {analysis.issues.filter((i) => i.level === "error").map((i, k) => (
                <li key={k}>{i.msg}</li>
              ))}
            </ul>
          </div>
        ) : type.sim === "ground" ? (
          <GroundSim key={type.id} analysis={analysis} />
        ) : type.sim === "drone" ? (
          <DroneSim key={type.id} analysis={analysis} />
        ) : (
          <div className="rounded-md border border-border bg-panel p-6 text-muted-foreground">
            La simulation du bras robotique n'est pas encore disponible. Les robots au sol et les drones peuvent déjà être pilotés.
          </div>
        )}
      </div>
    </div>
  );
}
