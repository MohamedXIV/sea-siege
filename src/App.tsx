import { useState } from "react";
import { Anchor, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhaserViewport } from "@/game/PhaserViewport";
import { DevControls } from "@/components/DevControls";
import { MatchHud } from "@/components/MatchHud";
import { MatchResultOverlay } from "@/components/MatchResultOverlay";
import { useSpacetime } from "@/network/useSpacetime";

/**
 * Gemini's original Tactical Deployment screen and Battlefield overlay.
 * React only renders menus; Phaser owns the actual battlefield canvas.
 */
export default function App() {
  const gameState = useSpacetime();
  const { status, subscriptionStatus, identity, activeMatch } = gameState;
  const [menuOpenedForMatch, setMenuOpenedForMatch] = useState<bigint | null>(null);
  const isPlaying = activeMatch?.phase === "active";
  const finished = activeMatch?.phase === "finished";
  const eliminated = isPlaying && gameState.myFaction?.eliminated === true;
  const menuOpen = menuOpenedForMatch === activeMatch?.id;
  const showResults = (finished || eliminated) && !menuOpen;
  const ready = status === "connected" && subscriptionStatus === "applied";

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#040d17] text-slate-100">
      <div className="absolute inset-0">
        <PhaserViewport />
      </div>

      {showResults ? (
        <MatchResultOverlay
          state={gameState}
          onDeployment={() => setMenuOpenedForMatch(activeMatch?.id ?? null)}
        />
      ) : isPlaying && !menuOpen ? (
        <MatchHud state={gameState} onMenu={() => setMenuOpenedForMatch(activeMatch?.id ?? null)} />
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(90deg,rgba(4,13,23,.97),rgba(4,13,23,.87)_64%,rgba(4,13,23,.72))]" />
          <div data-game-ui="true" className="pointer-events-none relative z-10 flex min-h-svh flex-col justify-between p-4 md:p-8">
            <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 border-b border-sky-500/20 pb-3">
              <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-sky-300">
                <span className={`size-3 rounded-full ${ready ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} />
                SpacetimeDB Authority Engine // {ready ? "Online" : "Connecting"}
              </div>
              <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                Client Identity:
                <span className="rounded border border-amber-500/30 bg-slate-900/90 px-2 py-0.5 text-amber-400">
                  {identity ? `${identity.slice(0, 9)}...${identity.slice(-6)}` : "Not connected"}
                </span>
              </div>
            </header>

            <section className="pointer-events-auto my-auto mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-6 py-7 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-7">
                {(isPlaying || finished) && (
                  <Button variant="outline" onClick={() => setMenuOpenedForMatch(null)}
                    className="border-sky-500/50 bg-slate-950 text-sky-300">
                    {finished ? "View final results" :
                      eliminated ? "View elimination" :
                        `Resume Match #${activeMatch.id.toString()}`}
                  </Button>
                )}
                <div className="inline-flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs uppercase tracking-widest text-amber-300">
                  <Waves className="size-3.5" /> Drowned Industrial Naval Warfare
                </div>
                <h1 className="text-5xl font-extrabold leading-none tracking-tight text-white md:text-6xl">
                  SEA <span className="text-sky-400">SIEGE</span>
                </h1>
                <p className="max-w-xl text-sm leading-relaxed text-slate-300 md:text-base">
                  Command a fragile industrial citadel in a world swallowed by the abyss.
                  Dredge submerged salvage, expand modular floating platforms, construct
                  shipyards and rotary artillery, and shatter rival strongholds across a living reactive ocean.
                </p>
                <div className="grid max-w-lg grid-cols-3 gap-2 pt-1 font-mono text-xs">
                  <div className="rounded border border-slate-800 bg-slate-900/80 p-2">
                    <div className="font-bold text-sky-400">2–8 Factions</div>
                    <div className="text-[11px] text-slate-400">Human or Server AI</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/80 p-2">
                    <div className="font-bold text-amber-400">Multi-Layer Grid</div>
                    <div className="text-[11px] text-slate-400">Platforms & Bridges</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/80 p-2">
                    <div className="font-bold text-emerald-400">Open Battlefield</div>
                    <div className="text-[11px] text-slate-400">Server-Owned Combat</div>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5 rounded-xl border border-slate-700 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-sm lg:col-span-5">
                <div className="border-b border-slate-800 pb-2 font-mono text-xs uppercase tracking-wider text-slate-400">
                  Tactical Deployment Console
                </div>
                <DevControls />
              </div>
            </section>

            <footer className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 font-mono text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <Anchor className="size-3.5" /> SEA SIEGE // Gemini Pixel-Art Reference · Real Phaser 4 + SpacetimeDB
              </span>
              <span>LMB Select/Build · RMB Move · Scroll Zoom · E Enemy · H Home</span>
            </footer>
          </div>
        </>
      )}
    </main>
  );
}
