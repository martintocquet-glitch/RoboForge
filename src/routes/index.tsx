import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Gauge, ShieldCheck, Wrench } from "lucide-react";
import hero from "@/assets/hero-robot.jpg";
import { ALL_PARTS, CATEGORY_LABELS } from "@/data/catalog";
import { ROBOT_TYPES } from "@/data/robot-types";
import type { Part, SimMode } from "@/data/types";
import { startFromPreset } from "@/lib/build-store";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RoboForge — Construisez et simulez votre robot" },
      { name: "description", content: "Choisissez carte mère, moteurs, batterie et capteurs réels, vérifiez la compatibilité puis pilotez votre robot en simulation." },
      { property: "og:title", content: "RoboForge — Construisez et simulez votre robot" },
      { property: "og:description", content: "Choisissez de vraies pièces, vérifiez la compatibilité et pilotez votre robot en simulation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const SIM_LABEL: Record<SimMode, string> = { ground: "Simulation au sol", drone: "Simulation de vol", arm: "Simulation de bras" };

function Home() {
  const navigate = useNavigate();
  const counts = Object.entries(CATEGORY_LABELS).map(([cat, label]) => ({
    label,
    n: ALL_PARTS.filter((p: Part) => p.category === cat).length,
  }));

  return (
    <div>
      <section className="relative overflow-hidden border-b border-border">
        <img src={hero} alt="Robot en cours d'assemblage sur un établi" className="absolute inset-0 h-full w-full object-cover opacity-50" width={1600} height={900} />
        <div className="absolute inset-0 bg-hero-fade" />
        <div className="absolute inset-0 bg-blueprint opacity-60" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-24 md:pb-24 md:pt-32">
          <p className="label-tech mb-4 text-primary">Atelier de robotique virtuel</p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight md:text-6xl">
            Assemblez votre robot pièce par pièce, puis faites-le rouler, voler ou saisir.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            {ALL_PARTS.length} composants réels — Arduino, Raspberry Pi, Jetson, Pixhawk, moteurs Pololu, servos Dynamixel, lidars SLAMTEC… L'atelier vérifie que tout est compatible et calcule poids, vitesse et autonomie.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" className="shadow-glow" onClick={() => document.getElementById("types")?.scrollIntoView({ behavior: "smooth" })}>
              Choisir un robot <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link to="/catalogue">Parcourir le catalogue</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-panel">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-border sm:grid-cols-4 lg:grid-cols-7">
          {counts.map((c) => (
            <div key={c.label} className="bg-panel px-4 py-4">
              <div className="font-display text-2xl font-bold tabular-nums">{c.n}</div>
              <div className="label-tech">{c.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="types" className="mx-auto max-w-7xl scroll-mt-16 px-4 py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-tech text-primary">Étape 1</p>
            <h2 className="mt-1 text-3xl font-bold">Quel robot voulez-vous construire ?</h2>
            <p className="mt-2 text-muted-foreground">Chaque modèle démarre avec une configuration qui fonctionne. Vous changez ensuite les pièces une à une.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROBOT_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                startFromPreset(t.id);
                void navigate({ to: "/atelier" });
              }}
              className="group relative flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 text-left shadow-panel transition-all hover:-translate-y-0.5 hover:border-primary"
            >
              <div className="flex w-full items-center justify-between">
                <span className="rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-xs font-medium text-primary">{t.short}</span>
                <span className="label-tech">{t.motorCount} moteurs</span>
              </div>
              <h3 className="text-xl font-semibold">{t.name}</h3>
              <p className="text-sm text-muted-foreground">{t.blurb}</p>
              <div className="mt-auto flex w-full items-center justify-between pt-2 text-sm">
                <span className="text-signal">{SIM_LABEL[t.sim]}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-panel">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 md:grid-cols-3">
          {[
            { icon: Wrench, title: "Assemblez", text: "Châssis, carte mère, moteurs, driver, batterie, roues ou hélices, capteurs : choisissez chaque pièce dans le catalogue." },
            { icon: ShieldCheck, title: "Vérifiez", text: "Tension trop forte, driver surchargé, broches manquantes, poussée insuffisante : chaque problème est signalé avec sa solution." },
            { icon: Gauge, title: "Simulez", text: "Pilotez au clavier, laissez l'évitement d'obstacles ou le suivi de ligne agir, faites voler le drone ou déplacer des objets au bras." },
          ].map((f) => (
            <div key={f.title}>
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-3 text-lg font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
