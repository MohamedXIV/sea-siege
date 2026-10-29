import { useState } from "react";
import { Anchor, Compass, DatabaseZap, Layers3, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhaserViewport } from "@/game/PhaserViewport";

type InfoTab = "status" | "controls";

export default function App() {
  const [tab, setTab] = useState<InfoTab>("status");

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0"><PhaserViewport /></div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(4,13,21,.92),rgba(4,13,21,.5)_50%,rgba(4,13,21,.12))]" />
      <div className="relative z-10 flex min-h-svh flex-col justify-between p-5 md:p-10 pointer-events-none">
        <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[.24em] text-primary"><Anchor className="size-4" /> SEA SIEGE <span className="text-muted-foreground">/ Foundation</span></div>
          <div role="status" className="flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300"><span className="size-2 rounded-full bg-amber-400" /> Backend not connected</div>
        </header>
        <section className="pointer-events-auto max-w-xl space-y-5 py-12">
          <div className="flex items-center gap-2 text-xs tracking-[.26em] uppercase text-primary"><Waves className="size-4" /> A world below the waterline</div>
          <h1 className="text-6xl font-black tracking-tight sm:text-7xl">SEA<br/><span className="text-primary">SIEGE</span></h1>
          <p className="max-w-md text-base leading-7 text-slate-300">The ocean is the battlefield. Build an industrial citadel, command naval fleets and cut the enemy’s lifelines.</p>
          <div className="max-w-md rounded-lg border border-border/70 bg-card/90 p-5 shadow-2xl backdrop-blur-sm">
            <div className="mb-4 flex gap-2">
              <Button size="sm" variant={tab === "status" ? "default" : "outline"} onClick={() => setTab("status")}><DatabaseZap className="size-4" /> Foundation</Button>
              <Button size="sm" variant={tab === "controls" ? "default" : "outline"} onClick={() => setTab("controls")}><Compass className="size-4" /> Controls</Button>
            </div>
            {tab === "status" ? (
              <div className="space-y-3 text-sm text-slate-300">
                <p className="flex items-center gap-2 font-semibold text-foreground"><Layers3 className="size-4 text-primary" /> A real Phaser 4 scene in a React application.</p>
                <p>This stage is intentionally a visual foundation, <strong>not a fake multiplayer match</strong>. SpacetimeDB tables, reducers, SDK bindings and authorized subscriptions are being implemented separately.</p>
                <p className="text-xs text-amber-300">No server or database has been published or verified yet.</p>
              </div>
            ) : (
              <div className="space-y-2 text-sm text-slate-300">
                <p>Middle/right mouse drag: pan ocean · Mouse wheel: zoom.</p>
                <p>Ship selection, orders and combat unlock only when the authoritative game state is connected.</p>
              </div>
            )}
          </div>
        </section>
        <footer className="text-xs text-slate-400">Real-stack foundation · Planned: Phaser 4 / TypeScript / SpacetimeDB / React / shadcn/ui</footer>
      </div>
    </main>
  );
}
