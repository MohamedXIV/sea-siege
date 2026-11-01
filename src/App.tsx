import { useState } from "react";
import { Anchor, Compass, DatabaseZap, Layers3, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhaserViewport } from "@/game/PhaserViewport";
import { DevControls } from "@/components/DevControls";
import { useSpacetime } from "@/network/useSpacetime";

type InfoTab = "multiplayer" | "status" | "controls";

export default function App() {
  const [tab, setTab] = useState<InfoTab>("multiplayer");
  const { status, identity } = useSpacetime();

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      {/* Authoritative Phaser Viewport */}
      <div className="absolute inset-0">
        <PhaserViewport />
      </div>

      {/* Atmospheric gradient overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(4,13,21,.92),rgba(4,13,21,.5)_50%,rgba(4,13,21,.12))]" />

      {/* UI Overlay */}
      <div className="relative z-10 flex min-h-svh flex-col justify-between p-5 md:p-8 pointer-events-none">
        {/* Top bar */}
        <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[.24em] text-primary">
            <Anchor className="size-4" /> SEA SIEGE{" "}
            <span className="text-muted-foreground">/ Connected Slice</span>
          </div>

          <div
            role="status"
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono ${
              status === "connected"
                ? "border-emerald-600/40 bg-emerald-950/40 text-emerald-300"
                : status === "connecting" || status === "reconnecting"
                ? "border-amber-600/40 bg-amber-950/40 text-amber-300"
                : "border-rose-600/40 bg-rose-950/40 text-rose-300"
            }`}
          >
            <span
              className={`size-2 rounded-full ${
                status === "connected"
                  ? "bg-emerald-400"
                  : status === "connecting" || status === "reconnecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-rose-500"
              }`}
            />
            <span>
              {status === "connected"
                ? `Connected (${identity?.slice(0, 8)}...)`
                : status === "reconnecting"
                ? "Reconnecting..."
                : status === "connecting"
                ? "Connecting..."
                : "Disconnected"}
            </span>
          </div>
        </header>

        {/* Main Content Area */}
        <section className="pointer-events-auto max-w-xl space-y-4 py-6">
          <div className="flex items-center gap-2 text-xs tracking-[.26em] uppercase text-primary">
            <Waves className="size-4" /> A world below the waterline
          </div>
          <h1 className="text-5xl font-black tracking-tight sm:text-6xl">
            SEA<br />
            <span className="text-primary">SIEGE</span>
          </h1>

          {/* Navigation Tabs */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={tab === "multiplayer" ? "default" : "outline"}
              onClick={() => setTab("multiplayer")}
            >
              <Anchor className="size-4" /> Multiplayer Match
            </Button>
            <Button
              size="sm"
              variant={tab === "status" ? "default" : "outline"}
              onClick={() => setTab("status")}
            >
              <DatabaseZap className="size-4" /> Architecture
            </Button>
            <Button
              size="sm"
              variant={tab === "controls" ? "default" : "outline"}
              onClick={() => setTab("controls")}
            >
              <Compass className="size-4" /> Navigation
            </Button>
          </div>

          {tab === "multiplayer" ? (
            <DevControls />
          ) : tab === "status" ? (
            <div className="max-w-md rounded-lg border border-border/70 bg-card/90 p-5 shadow-2xl backdrop-blur-sm space-y-3 text-sm text-slate-300">
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <Layers3 className="size-4 text-primary" /> Official SpacetimeDB Integration
              </p>
              <p>
                Connected directly to local standalone SpacetimeDB instance (`sea-siege-dev`).
              </p>
              <ul className="list-disc list-inside text-xs space-y-1 text-slate-400">
                <li>Authoritative simulation running server-side (WASM).</li>
                <li>Private tables protected by server visibility views.</li>
                <li>Live per-identity subscriptions streaming to Phaser.</li>
                <li>Bounded interpolation via SnapshotBuffer for smooth naval motion.</li>
              </ul>
            </div>
          ) : (
            <div className="max-w-md rounded-lg border border-border/70 bg-card/90 p-5 shadow-2xl backdrop-blur-sm space-y-2 text-sm text-slate-300">
              <p>Middle or right mouse drag: pan ocean view.</p>
              <p>Mouse wheel: zoom camera in and out.</p>
              <p>Left-click owned ship: select vessel.</p>
              <p>Click water with vessel selected: send authoritative server move order.</p>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="text-xs text-slate-400">
          Phase 2 Connected Client · Phaser 4.2.1 / TypeScript / SpacetimeDB 2.14.0 / React 19
        </footer>
      </div>
    </main>
  );
}
