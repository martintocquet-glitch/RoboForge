<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- Simulation logic stays in the 2D sim components (`src/components/sim/*-sim.tsx`); each step publishes a snapshot into a `live` ref typed in `scene-types.ts`, and the 3D scenes (`src/components/sim3d/`) only read it — keeps one physics source for both views.
- 3D scenes are loaded with `React.lazy` and rendered only after the sim effect sets its static world, so three.js never runs during SSR; the error boundary lives in `src/components/sim/scene-view.tsx` so the SSR graph never imports three/drei.
- Do not use drei `<Html>` in the scenes (it unmounts its React root synchronously and logs errors on view switches); draw labels as canvas-texture sprites.
- Sim components are keyed by robot type in the simulator route so the default scenario follows the stored build after hydration.
