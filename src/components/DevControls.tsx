import { useState } from "react";
import {
  Compass,
  Play,
  PlusCircle,
  RefreshCw,
  Users,
  Radio,
} from "lucide-react";
import { Button } from "./ui/button";
import { useSpacetime } from "../network/useSpacetime";

export function DevControls() {
  const {
    status,
    identity,
    error,
    matches,
    activeMatchId,
    activeMatch,
    myMembership,
    myFaction,
    myShips,
    myStructures,
    visibleEnemies,
    createMatch,
    joinMatch,
    startMatch,
    setActiveMatchId,
    resetIdentity,
    client,
  } = useSpacetime();

  const [slots, setSlots] = useState<number>(2);
  const [manualMatchId, setManualMatchId] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);

  const handleCreate = async () => {
    setIsActing(true);
    setActionError(null);
    try {
      await createMatch(slots);
      setShowBrowser(false);
    } catch (err: any) {
      setActionError(err?.message || "Failed to create match");
    } finally {
      setIsActing(false);
    }
  };

  const handleJoin = async (id: bigint) => {
    setIsActing(true);
    setActionError(null);
    try {
      await joinMatch(id);
      setShowBrowser(false);
    } catch (err: any) {
      setActionError(err?.message || "Failed to join match");
    } finally {
      setIsActing(false);
    }
  };

  const handleStart = async () => {
    if (!activeMatchId) return;
    setIsActing(true);
    setActionError(null);
    try {
      await startMatch(activeMatchId);
    } catch (err: any) {
      setActionError(err?.message || "Failed to start match");
    } finally {
      setIsActing(false);
    }
  };

  const isHost =
    activeMatch && identity
      ? activeMatch.host.toHexString() === identity
      : false;

  return (
    <aside className="pointer-events-auto max-w-md w-full space-y-4 rounded-xl border border-border/80 bg-slate-950/85 p-5 shadow-2xl backdrop-blur-md text-foreground">
      {/* Network Header */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <Radio className="size-4 text-cyan-400" />
          <span className="text-xs font-semibold tracking-wider uppercase text-cyan-400">
            P0 Multi-Client Harness
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span
            className={`size-2 rounded-full ${
              status === "connected"
                ? "bg-emerald-400 animate-pulse"
                : status === "connecting" || status === "reconnecting"
                ? "bg-amber-400 animate-ping"
                : "bg-rose-500"
            }`}
          />
          <span className="capitalize">{status}</span>
        </div>
      </div>

      {/* Identity & Session */}
      <div className="flex items-center justify-between gap-2 text-xs bg-slate-900/80 px-3 py-2 rounded-lg border border-border/40 font-mono">
        <div className="truncate">
          <span className="text-slate-400">Identity: </span>
          <span className="text-cyan-300" title={identity || "None"}>
            {identity ? `${identity.slice(0, 10)}...${identity.slice(-6)}` : "Not connected"}
          </span>
        </div>
        <button
          onClick={resetIdentity}
          title="Clear token and reconnect with a fresh identity (creates a second test player)"
          className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition"
        >
          <RefreshCw className="size-3" /> New Identity
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/40 p-2.5 rounded-md">
          {error}
        </div>
      )}
      {actionError && (
        <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 p-2.5 rounded-md">
          {actionError}
        </div>
      )}

      {/* Match Context / Lobby */}
      {activeMatch && !showBrowser ? (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between bg-cyan-950/30 border border-cyan-800/40 p-3 rounded-lg">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-cyan-100">
                  Match #{activeMatch.id.toString()}
                </span>
                {isHost && (
                  <span className="text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
                    HOST
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Phase:{" "}
                <span
                  className={`font-semibold uppercase tracking-wider ${
                    activeMatch.phase === "active"
                      ? "text-emerald-400"
                      : activeMatch.phase === "lobby"
                      ? "text-amber-300"
                      : "text-slate-400"
                  }`}
                >
                  {activeMatch.phase}
                </span>{" "}
                · {activeMatch.maxSlots} max slots
              </div>
            </div>

            {myMembership && (
              <div className="text-right">
                <span className="text-xs font-semibold text-cyan-300 bg-cyan-900/40 px-2 py-1 rounded border border-cyan-700/50">
                  Slot {myMembership.slot}
                </span>
              </div>
            )}
          </div>

          {/* Faction Telemetry */}
          {myFaction && (
            <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
              <div className="bg-slate-900/60 p-2 rounded border border-border/40">
                <div className="text-slate-400 text-[10px] uppercase">Salvage</div>
                <div className="font-mono font-bold text-amber-300 text-sm">
                  {myFaction.salvage}
                </div>
              </div>
              <div className="bg-slate-900/60 p-2 rounded border border-border/40">
                <div className="text-slate-400 text-[10px] uppercase">Fleet</div>
                <div className="font-mono font-bold text-cyan-300 text-sm">
                  {myShips.length}
                </div>
              </div>
              <div className="bg-slate-900/60 p-2 rounded border border-border/40">
                <div className="text-slate-400 text-[10px] uppercase">Bases</div>
                <div className="font-mono font-bold text-emerald-300 text-sm">
                  {myStructures.length}
                </div>
              </div>
              <div className="bg-slate-900/60 p-2 rounded border border-border/40">
                <div className="text-slate-400 text-[10px] uppercase">Hostiles</div>
                <div className="font-mono font-bold text-rose-400 text-sm">
                  {visibleEnemies.length}
                </div>
              </div>
            </div>
          )}

          {/* Lobby Host Control */}
          {activeMatch.phase === "lobby" && (
            <div className="pt-1">
              {isHost ? (
                <Button
                  onClick={handleStart}
                  disabled={isActing}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Play className="size-4" /> Start Match
                </Button>
              ) : (
                <div className="text-xs text-center text-amber-300/90 bg-amber-950/20 border border-amber-800/30 py-2 rounded-md">
                  Waiting for host to start match...
                </div>
              )}
            </div>
          )}

          {/* Active Match Controls / Instructions */}
          {activeMatch.phase === "active" && (
            <div className="text-xs text-slate-300 bg-slate-900/60 border border-border/40 p-3 rounded-lg space-y-1">
              <p className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <Compass className="size-3.5" /> Authoritative Ship Movement:
              </p>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                Click your fleet vessel to select it, then click open water to send a movement order. Updates are streamed authoritatively from SpacetimeDB.
              </p>
            </div>
          )}

          <div className="flex justify-between items-center pt-1 text-[11px] text-slate-400">
            <span>Database: {client.database}</span>
            <button
              onClick={() => setShowBrowser(true)}
              className="text-cyan-400 hover:underline"
            >
              Browse other matches
            </button>
          </div>
        </div>
      ) : (
        /* Match Creator & Browser */
        <div className="space-y-4">
          {activeMatch && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowBrowser(false)}
                className="text-xs text-cyan-400 hover:underline"
              >
                ← Back to Match #{activeMatch.id.toString()}
              </button>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <PlusCircle className="size-3.5 text-cyan-400" /> Create New Match
            </label>
            <div className="flex gap-2">
              <select
                value={slots}
                onChange={(e) => setSlots(Number(e.target.value))}
                className="bg-slate-900 border border-border/60 rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value={2}>2 Players (Duel)</option>
                <option value={4}>4 Players</option>
                <option value={6}>6 Players</option>
                <option value={8}>8 Players (Full)</option>
              </select>
              <Button
                onClick={handleCreate}
                disabled={isActing || status !== "connected"}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold"
              >
                Create Lobby
              </Button>
            </div>
          </div>

          {/* Open Lobbies List */}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Users className="size-3.5 text-cyan-400" /> Active / Open Matches
              </span>
              <span>{matches.length} found</span>
            </div>

            {matches.length === 0 ? (
              <div className="text-xs text-slate-500 py-3 text-center bg-slate-900/40 rounded border border-border/30">
                No active matches in database. Create one above!
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {matches.map((m) => (
                  <div
                    key={m.id.toString()}
                    className="flex items-center justify-between p-2 rounded bg-slate-900/70 border border-border/40 text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-200">Match #{m.id.toString()}</span>
                      <span className="ml-2 text-[10px] text-slate-400 uppercase font-mono">
                        [{m.phase}]
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2.5 text-[11px]"
                        onClick={() => handleJoin(m.id)}
                        disabled={isActing || status !== "connected"}
                      >
                        Join / View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual ID Join */}
          <div className="flex gap-2 pt-1 border-t border-border/40">
            <input
              type="text"
              placeholder="Join by Match ID..."
              value={manualMatchId}
              onChange={(e) => setManualMatchId(e.target.value)}
              className="bg-slate-900 border border-border/60 rounded px-2.5 py-1 text-xs text-foreground flex-1 focus:outline-none"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (manualMatchId.trim()) handleJoin(BigInt(manualMatchId.trim()));
              }}
              disabled={isActing || !manualMatchId.trim()}
              className="text-xs h-7"
            >
              Join ID
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
