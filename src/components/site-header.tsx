import { Link } from "@tanstack/react-router";
import { Cpu } from "lucide-react";

const NAV = [
  { to: "/", label: "Accueil" },
  { to: "/atelier", label: "Atelier" },
  { to: "/simulateur", label: "Simulateur" },
  { to: "/catalogue", label: "Catalogue" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
            <Cpu className="h-4 w-4" />
          </span>
          RoboForge
        </Link>
        <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="rounded px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
