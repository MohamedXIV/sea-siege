import { useEffect, useState } from "react";
import { Hammer, Crosshair, CircleStop, Pickaxe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GEMINI_BUILD_MODE_EVENT, GEMINI_SELECTION_EVENT, GEMINI_FEEDBACK_EVENT,
  GEMINI_BUILD_PREVIEW_EVENT,
} from "@/game/SeaScene";
import { spacetimeClient, type SpacetimeClientState } from "@/network/spacetime-client";
import { CONSTRUCTION_RULES } from "../../spacetimedb/src/sim/construction";
import { ECONOMY_RULES } from "../../spacetimedb/src/sim/economy";
import { RESOURCE_TYPES, type ResourceKind } from "../../spacetimedb/src/sim/materials";
import { ShipRefitPanel } from "@/components/ShipRefitPanel";
import { BuildingInspector } from "@/components/BuildingInspector";

type Selection =
  | { type: "ship"; id: bigint; shipIds?: bigint[] }
  | { type: "structure"; id: bigint }
  | null;
type BuildKind = "platform" | "shipyard" | "workshop" | "cannon" | "salvage_rig";
const BUILD_TYPES: { kind: BuildKind; label: string }[] = [
  { kind: "platform", label: "Floating Platform" },
  { kind: "shipyard", label: "Shipyard" },
  { kind: "workshop", label: "Workshop" },
  { kind: "cannon", label: "Defense Cannon" },
  { kind: "salvage_rig", label: "Salvage Rig" },
];

/**
 * Minimal functional version of Gemini's Construction Dock + Selection Panel.
 * The server remains authoritative; all buttons invoke real reducers.
 */
export function GeminiCommandDock({ state }: { state: SpacetimeClientState }) {
  const [selected, setSelected] = useState<Selection>(null);
  const [buildKind, setBuildKind] = useState<BuildKind | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    reason: string | null; count: number;
    x: number; y: number; endX: number; endY: number;
  } | null>(null);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<Selection>).detail;
      setSelected(detail);
      setError(null);
    };
    const feedback = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; success?: boolean }>).detail;
      if (detail?.success) {
        setConfirmation(detail.message);
        setError(null);
      } else {
        setError(detail?.message || "Command rejected");
        setConfirmation(null);
      }
    };
    const placementPreview = (event: Event) =>
      setPreview((event as CustomEvent<{
        reason: string | null; count: number;
        x: number; y: number; endX: number; endY: number;
      }>).detail);
    const buildModeUpdate = (event: Event) => {
      const kind = (event as CustomEvent<{ kind: BuildKind | null }>).detail?.kind ?? null;
      setBuildKind(kind);
      if (kind === null) setPreview(null);
    };
    window.addEventListener(GEMINI_BUILD_MODE_EVENT, buildModeUpdate);
    window.addEventListener(GEMINI_SELECTION_EVENT, listener);
    window.addEventListener(GEMINI_FEEDBACK_EVENT, feedback);
    window.addEventListener(GEMINI_BUILD_PREVIEW_EVENT, placementPreview);
    return () => {
      window.removeEventListener(GEMINI_SELECTION_EVENT, listener);
      window.removeEventListener(GEMINI_BUILD_MODE_EVENT, buildModeUpdate);
      window.removeEventListener(GEMINI_FEEDBACK_EVENT, feedback);
      window.removeEventListener(GEMINI_BUILD_PREVIEW_EVENT, placementPreview);
    };
  }, []);

  useEffect(() => {
    setSelected(null);
    setBuildKind(null);
    setPreview(null);
    window.dispatchEvent(new CustomEvent(GEMINI_BUILD_MODE_EVENT, { detail: { kind: null } }));
  }, [state.activeMatchId]);

  const perform = async (job: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setConfirmation(null);
    try { await job(); }
    catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Command rejected by server");
    } finally { setPending(false); }
  };

  const beginBuild = (kind: BuildKind | null) => {
    setBuildKind(kind);
    setPreview(null);
    setError(null);
    setConfirmation(null);
    window.dispatchEvent(new CustomEvent(GEMINI_BUILD_MODE_EVENT, { detail: { kind } }));
  };

  const selectedShipIds = selected?.type === "ship"
    ? selected.shipIds ?? [selected.id] : [];
  const selectedShips = state.myShips.filter(ship => selectedShipIds.includes(ship.id));
  const selectedShip = selectedShips.length === 1 ? selectedShips[0] : undefined;
  const selectedBuilding = selected?.type === "structure"
    ? state.battleStructures.find(st => st.id === selected.id)
    : undefined;
  const salvage = state.myFaction?.salvage ?? 0;

  const harvestNearest = (kind: ResourceKind) => {
    if (!selectedShip) return;
    const choices = kind === "iron"
      ? state.salvageNodes.filter(n => n.remaining > 0).map(n => ({
          id: n.id, gridX: n.gridX, gridY: n.gridY,
        }))
      : state.materialDeposits
          .filter(n => n.kind === kind && n.remaining > 0)
          .map(n => ({ id: n.id, gridX: n.gridX, gridY: n.gridY }));
    const node = choices.sort((a, b) =>
      Math.hypot(selectedShip.x - a.gridX - 0.5, selectedShip.y - a.gridY - 0.5) -
      Math.hypot(selectedShip.x - b.gridX - 0.5, selectedShip.y - b.gridY - 0.5))[0];
    if (!node) {
      setError(`No ${RESOURCE_TYPES[kind].name} deposit available`);
      return;
    }
    const distance = Math.hypot(
      selectedShip.x - node.gridX - 0.5, selectedShip.y - node.gridY - 0.5);
    void perform(() => distance <= ECONOMY_RULES.harvestRangeCells
      ? kind === "iron"
        ? spacetimeClient.orderHarvest(selectedShip.id, node.id)
        : spacetimeClient.orderMaterialHarvest(selectedShip.id, node.id)
      : spacetimeClient.issueShipOrder(
        selectedShip.id, node.gridX + 0.5, node.gridY + 0.5));
  };

  return (
    <div className="mt-3 grid gap-2 border-t border-slate-700 pt-3 lg:grid-cols-[1.2fr_1fr]">
      <section>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-bold text-sky-300">
            <Hammer className="size-3.5" /> CONSTRUCTION DOCK
          </span>
          {buildKind && (
            <button onClick={() => beginBuild(null)} className="text-amber-300 hover:text-white">
              Cancel {buildKind}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {BUILD_TYPES.map(({ kind, label }) => {
            const cost = CONSTRUCTION_RULES.definitions[kind].cost;
            return (
              <Button
                key={kind} size="sm"
                variant={buildKind === kind ? "default" : "outline"}
                disabled={pending || salvage < cost}
                onClick={() => beginBuild(buildKind === kind ? null : kind)}
                className="h-auto min-h-9 flex-col items-start gap-0.5 border-slate-700 p-1.5 text-left text-[10px]"
              >
                <span className="max-w-full truncate font-semibold">{label}</span>
                <span className="font-mono text-amber-300">{cost} Iron</span>
              </Button>
            );
          })}
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-slate-400">
          {buildKind
            ? "Drag to build a rectangular group (up to 64). Start/end must be legal; 2×2 buildings need aligned endpoints. Esc / right-click cancels. Green = valid, red = blocked."
            : "Build in the map, starting with connected floating platforms. Right-click issues ship movement."}
        </div>
        {buildKind && preview && (
          <p role="status" className={`mt-1 text-[10px] ${preview.reason ? "text-rose-300" : "text-emerald-300"}`}>
            {preview.reason ?? `${preview.count} valid structures`} · ({preview.x}, {preview.y}) → ({preview.endX}, {preview.endY})
          </p>
        )}
      </section>

      <section className="min-w-0 max-h-[42svh] overflow-y-auto pr-1">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-sky-300">
          <Crosshair className="size-3.5" /> TACTICAL COMMAND
        </div>
        {selectedShips.length > 1 ? (
          <div className="space-y-1.5 text-xs">
            <div className="font-semibold text-sky-300">{selectedShips.length} SHIPS SELECTED</div>
            <Button size="sm" variant="outline" disabled={pending}
              onClick={() => void perform(async () => {
                const results = await Promise.allSettled(
                  selectedShips.map(ship => spacetimeClient.stopShip(ship.id))
                );
                const failures = results.filter(result => result.status === "rejected");
                if (failures.length) throw new Error(`${failures.length} stop orders were rejected`);
              })}
              className="border-slate-700 text-xs text-rose-300">
              <CircleStop className="size-3" /> Stop selected fleet
            </Button>
            <p className="text-[10px] text-slate-400">
              Right-click water to move selected ships in a loose formation.
              Drag on empty water to deselect.
            </p>
          </div>
        ) : selectedShip ? (
          <div className="space-y-1.5 text-xs">
            <div className="font-semibold text-white">{selectedShip.kind.toUpperCase()} · HP {selectedShip.hp}</div>
            <div className="flex flex-wrap gap-1.5">
              {(["iron", "oil", "alloy", "isotope"] as const).map(kind => (
                <Button key={kind} size="sm" variant="outline"
                  disabled={pending || ECONOMY_RULES.ships[selectedShip.kind as keyof typeof ECONOMY_RULES.ships]?.harvestPerSecond === 0}
                  onClick={() => harvestNearest(kind)}
                  className="h-7 border-slate-700 px-2 text-[11px]"
                >
                  <Pickaxe className="size-3" />
                  <span style={{ color: RESOURCE_TYPES[kind].color }}>
                    {RESOURCE_TYPES[kind].name}
                  </span>
                </Button>
              ))}
              <Button size="sm" variant="outline" disabled={pending}
                onClick={() => void perform(() => spacetimeClient.stopShip(selectedShip.id))}
                className="border-slate-700 text-xs text-rose-300">
                <CircleStop className="size-3" /> Stop
              </Button>
            </div>
            <p className="text-[10px] text-slate-400">Pick a material to approach or gather. At harvesting range, click again to start extraction; combat stays available.</p>
            <ShipRefitPanel state={state} ship={selectedShip} />
          </div>
        ) : selectedBuilding ? (
          <BuildingInspector
            state={state} building={selectedBuilding}
            pending={pending} perform={perform}
          />
        ) : (
          <p className="text-[11px] leading-5 text-slate-400">
            Click any building to inspect its purpose and status. Click an owned Shipyard to queue Scouts, Gunboats or Siege ships.
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-[11px] text-rose-300">{error}</p>}
        {confirmation && <p role="status" className="mt-2 text-[11px] text-emerald-300">{confirmation}</p>}
      </section>
    </div>
  );
}
