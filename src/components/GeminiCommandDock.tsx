import { useEffect, useState } from "react";
import {
  Anchor,
  CircleStop,
  Crosshair,
  Hammer,
  Heart,
  Pickaxe,
  Shield,
  Wrench,
} from "lucide-react";
import {
  GEMINI_BUILD_MODE_EVENT,
  GEMINI_BUILD_PREVIEW_EVENT,
  GEMINI_FEEDBACK_EVENT,
  GEMINI_SELECTION_EVENT,
} from "@/game/SeaScene";
import {
  spacetimeClient,
  type SpacetimeClientState,
} from "@/network/spacetime-client";
import { CONSTRUCTION_RULES } from "../../spacetimedb/src/sim/construction";
import { ECONOMY_RULES } from "../../spacetimedb/src/sim/economy";
import {
  RESOURCE_TYPES,
  type ResourceKind,
} from "../../spacetimedb/src/sim/materials";
import { ShipRefitPanel } from "@/components/ShipRefitPanel";
import { BuildingInspector } from "@/components/BuildingInspector";

type Selection =
  | { type: "ship"; id: bigint; shipIds?: bigint[] }
  | { type: "structure"; id: bigint }
  | null;

type BuildKind = "platform" | "shipyard" | "workshop" | "cannon" | "salvage_rig";
type DockTab = "build" | "command";

const BUILD_TYPES: { kind: BuildKind; label: string; short: string }[] = [
  { kind: "platform", label: "Floating Platform", short: "Platform" },
  { kind: "shipyard", label: "Shipyard", short: "Shipyard" },
  { kind: "workshop", label: "Workshop", short: "Workshop" },
  { kind: "cannon", label: "Defense Cannon", short: "Cannon" },
  { kind: "salvage_rig", label: "Salvage Rig", short: "Rig" },
];

/**
 * Industrial bottom command bar:
 * - Left: Tactical / Command Dock (BUILD & COMMAND tabs wired to real reducers)
 * - Right: Building Inspector / Ship Status & Workshop Refit Panel
 */
export function GeminiCommandDock({ state }: { state: SpacetimeClientState }) {
  const [selected, setSelected] = useState<Selection>(null);
  const [activeTab, setActiveTab] = useState<DockTab>("build");
  const [buildKind, setBuildKind] = useState<BuildKind | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    reason: string | null;
    count: number;
    x: number;
    y: number;
    endX: number;
    endY: number;
  } | null>(null);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<Selection>).detail;
      setSelected(detail);
      setError(null);
      if (detail?.type === "ship") {
        setActiveTab("command");
      }
    };
    const feedback = (event: Event) => {
      const detail = (
        event as CustomEvent<{ message: string; success?: boolean }>
      ).detail;
      if (detail?.success) {
        setConfirmation(detail.message);
        setError(null);
      } else {
        setError(detail?.message || "Command rejected");
        setConfirmation(null);
      }
    };
    const placementPreview = (event: Event) =>
      setPreview(
        (
          event as CustomEvent<{
            reason: string | null;
            count: number;
            x: number;
            y: number;
            endX: number;
            endY: number;
          }>
        ).detail
      );
    const buildModeUpdate = (event: Event) => {
      const kind =
        (event as CustomEvent<{ kind: BuildKind | null }>).detail?.kind ?? null;
      setBuildKind(kind);
      if (kind !== null) setActiveTab("build");
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
    window.dispatchEvent(
      new CustomEvent(GEMINI_BUILD_MODE_EVENT, { detail: { kind: null } })
    );
  }, [state.activeMatchId]);

  const perform = async (job: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setConfirmation(null);
    try {
      await job();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : "Command rejected by server"
      );
    } finally {
      setPending(false);
    }
  };

  const beginBuild = (kind: BuildKind | null) => {
    setBuildKind(kind);
    setPreview(null);
    setError(null);
    setConfirmation(null);
    window.dispatchEvent(
      new CustomEvent(GEMINI_BUILD_MODE_EVENT, { detail: { kind } })
    );
  };

  const selectedShipIds =
    selected?.type === "ship" ? (selected.shipIds ?? [selected.id]) : [];
  const selectedShips = state.myShips.filter((ship) =>
    selectedShipIds.includes(ship.id)
  );
  const selectedShip =
    selectedShips.length === 1 ? selectedShips[0] : undefined;
  const selectedBuilding =
    selected?.type === "structure"
      ? state.battleStructures.find((st) => st.id === selected.id)
      : undefined;
  const selectedAttackOrders = state.attackOrders.filter((order) =>
    selectedShipIds.includes(order.shipId)
  );
  const selectedAttack = selectedShip
    ? selectedAttackOrders.find((order) => order.shipId === selectedShip.id)
    : undefined;
  const salvage = state.myFaction?.salvage ?? 0;

  const selectedShipRule = selectedShip
    ? ECONOMY_RULES.ships[
        selectedShip.kind as keyof typeof ECONOMY_RULES.ships
      ]
    : undefined;
  const selectedShipMaxHp = selectedShipRule?.hp ?? Math.max(1, selectedShip?.hp ?? 1);
  const selectedShipHpPct = selectedShip
    ? Math.max(
        0,
        Math.min(100, Math.round((selectedShip.hp / selectedShipMaxHp) * 100))
      )
    : 0;

  const harvestNearest = (kind: ResourceKind) => {
    if (!selectedShip) return;
    const choices =
      kind === "iron"
        ? state.salvageNodes
            .filter((n) => n.remaining > 0)
            .map((n) => ({ id: n.id, gridX: n.gridX, gridY: n.gridY }))
        : state.materialDeposits
            .filter((n) => n.kind === kind && n.remaining > 0)
            .map((n) => ({ id: n.id, gridX: n.gridX, gridY: n.gridY }));
    const node = choices.sort(
      (a, b) =>
        Math.hypot(
          selectedShip.x - a.gridX - 0.5,
          selectedShip.y - a.gridY - 0.5
        ) -
        Math.hypot(
          selectedShip.x - b.gridX - 0.5,
          selectedShip.y - b.gridY - 0.5
        )
    )[0];
    if (!node) {
      setError(`No ${RESOURCE_TYPES[kind].name} deposit available`);
      return;
    }
    const distance = Math.hypot(
      selectedShip.x - node.gridX - 0.5,
      selectedShip.y - node.gridY - 0.5
    );
    void perform(() =>
      distance <= ECONOMY_RULES.harvestRangeCells
        ? kind === "iron"
          ? spacetimeClient.orderHarvest(selectedShip.id, node.id)
          : spacetimeClient.orderMaterialHarvest(selectedShip.id, node.id)
        : spacetimeClient.issueShipOrder(
            selectedShip.id,
            node.gridX + 0.5,
            node.gridY + 0.5
          )
    );
  };

  return (
    <div className="pointer-events-auto grid min-w-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[1.15fr_1fr]">
      {/* Left Panel: Tactical / Command Dock */}
      <section className="flex min-w-0 flex-col">
        <div className="hud-plate-header mx-auto px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-100/90">
          Tactical / Command Dock
        </div>
        <div className="hud-panel flex flex-1 flex-col justify-between p-2">
          {/* Tabs */}
          <div className="mb-2 flex items-center justify-between gap-1.5">
            <div className="grid flex-1 grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("build")}
                className={`flex items-center justify-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  activeTab === "build"
                    ? "hud-btn-active text-amber-200"
                    : "hud-btn text-slate-300"
                }`}
              >
                <Hammer className="size-3.5" /> Build
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("command")}
                className={`flex items-center justify-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  activeTab === "command"
                    ? "hud-btn-active text-amber-200"
                    : "hud-btn text-slate-300"
                }`}
              >
                <Crosshair className="size-3.5" /> Command
                {selectedShips.length > 0 && (
                  <span className="rounded bg-cyan-500/20 px-1 font-mono text-[10px] text-cyan-300">
                    {selectedShips.length}
                  </span>
                )}
              </button>
            </div>
            {buildKind && (
              <button
                type="button"
                onClick={() => beginBuild(null)}
                className="hud-btn rounded border-amber-500/60 px-2 py-1 text-[10px] font-bold uppercase text-amber-300"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Tab Body */}
          {activeTab === "build" ? (
            <div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {BUILD_TYPES.map(({ kind, label, short }) => {
                  const cost = CONSTRUCTION_RULES.definitions[kind].cost;
                  const active = buildKind === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      title={`${label} — ${cost} Iron`}
                      disabled={pending || salvage < cost}
                      onClick={() => beginBuild(active ? null : kind)}
                      className={`flex min-h-[54px] flex-col items-center justify-center gap-0.5 rounded px-1.5 py-1.5 text-center disabled:opacity-40 ${
                        active
                          ? "hud-btn-active text-amber-100"
                          : "hud-btn text-slate-200"
                      }`}
                    >
                      <Wrench
                        className={`size-4 ${
                          active ? "text-amber-300" : "text-cyan-300"
                        }`}
                      />
                      <span className="max-w-full truncate text-[10px] font-bold">
                        {short}
                      </span>
                      <span className="font-mono text-[10px] text-amber-300">
                        {cost} Fe
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400">
                <span>
                  {buildKind
                    ? "Drag to build up to 64 tiles · Esc / RMB cancels."
                    : "LMB select/box-select · RMB move/attack · H home · E enemy"}
                </span>
                {buildKind && preview && (
                  <span
                    role="status"
                    className={`font-mono ${
                      preview.reason ? "text-rose-300" : "text-emerald-300"
                    }`}
                  >
                    {preview.reason ?? `${preview.count} valid`} ({preview.x},
                    {preview.y})→({preview.endX},{preview.endY})
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedShips.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedShip &&
                      (["iron", "oil", "alloy", "isotope"] as const).map(
                        (kind) => (
                          <button
                            key={kind}
                            type="button"
                            disabled={
                              pending ||
                              selectedShipRule?.harvestPerSecond === 0
                            }
                            onClick={() => harvestNearest(kind)}
                            className="hud-btn flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40"
                          >
                            <Pickaxe className="size-3.5 text-slate-300" />
                            <span style={{ color: RESOURCE_TYPES[kind].color }}>
                              {RESOURCE_TYPES[kind].name}
                            </span>
                          </button>
                        )
                      )}

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        void perform(async () => {
                          if (selectedShip) {
                            await spacetimeClient.stopShip(selectedShip.id);
                            return;
                          }
                          const results = await Promise.allSettled(
                            selectedShips.map((ship) =>
                              spacetimeClient.stopShip(ship.id)
                            )
                          );
                          const failures = results.filter(
                            (r) => r.status === "rejected"
                          );
                          if (failures.length) {
                            throw new Error(
                              `${failures.length} stop orders were rejected`
                            );
                          }
                        })
                      }
                      className="hud-btn flex items-center gap-1 rounded border-rose-800/70 px-2.5 py-1.5 text-[11px] font-bold text-rose-300 disabled:opacity-40"
                    >
                      <CircleStop className="size-3.5" />
                      {selectedShips.length > 1 ? "Stop Fleet" : "Stop"}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Right-click water to move · Right-click enemy ship/structure
                    to attack · Drag empty sea to deselect.
                  </p>
                </>
              ) : (
                <div className="hud-inset px-2.5 py-2 text-[11px] text-slate-400">
                  Select one or more allied ships on the ocean to issue Stop or
                  Harvest orders, or right-click directly to move/attack.
                </div>
              )}
            </div>
          )}

          {(error || confirmation) && (
            <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
              {error && (
                <p role="alert" className="text-rose-300">
                  {error}
                </p>
              )}
              {confirmation && (
                <p role="status" className="text-emerald-300">
                  {confirmation}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Right Panel: Building Inspector / Ship Status Panel */}
      <section className="flex min-w-0 flex-col">
        <div className="hud-plate-header mx-auto px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-100/90">
          Building Inspector / Ship Status Panel
        </div>
        <div className="hud-panel hud-scroll max-h-[210px] flex-1 overflow-y-auto p-2.5">
          {selectedShips.length > 1 ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between border-b border-[#334350] pb-1.5">
                <span className="font-extrabold uppercase tracking-wider text-amber-200">
                  TASK FORCE · {selectedShips.length} SHIPS
                </span>
                {selectedAttackOrders.length > 0 && (
                  <span className="rounded border border-rose-800/70 bg-rose-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
                    Engaging ({selectedAttackOrders.length})
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {selectedShips.slice(0, 6).map((ship) => (
                  <div
                    key={ship.id.toString()}
                    className="hud-inset flex items-center justify-between px-2 py-1 text-[11px]"
                  >
                    <span className="font-bold uppercase text-cyan-200">
                      {ship.kind}
                    </span>
                    <span className="font-mono text-emerald-300">
                      HP {ship.hp}
                    </span>
                  </div>
                ))}
              </div>
              {selectedShips.length > 6 && (
                <p className="text-[10px] text-slate-400">
                  +{selectedShips.length - 6} additional vessels in formation.
                </p>
              )}
            </div>
          ) : selectedShip ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="hud-inset flex size-9 items-center justify-center border border-[#5c4d3e] text-cyan-300">
                    <Anchor className="size-4" />
                  </div>
                  <div>
                    <div className="font-extrabold uppercase tracking-wider text-amber-100">
                      {selectedShip.kind}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="flex items-center gap-0.5 text-emerald-300">
                        <Heart className="size-3 text-rose-400" />
                        {selectedShip.hp}/{selectedShipMaxHp}
                      </span>
                      {selectedShipRule && (
                        <span className="flex items-center gap-0.5 text-cyan-300">
                          <Shield className="size-3" />
                          Speed {selectedShipRule.speed}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {selectedAttack && (
                  <span className="rounded border border-rose-800/80 bg-rose-950/60 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
                    Attacking {selectedAttack.targetType} #
                    {selectedAttack.targetId.toString()}
                  </span>
                )}
              </div>

              {/* Hull integrity bar */}
              <div className="hud-inset h-2 w-full overflow-hidden p-[1px]">
                <div
                  className="h-full rounded-[2px] bg-gradient-to-r from-emerald-600 to-emerald-300 transition-all"
                  style={{ width: `${selectedShipHpPct}%` }}
                />
              </div>

              <ShipRefitPanel state={state} ship={selectedShip} />
            </div>
          ) : selectedBuilding ? (
            <BuildingInspector
              state={state}
              building={selectedBuilding}
              pending={pending}
              perform={perform}
            />
          ) : (
            <div className="hud-inset flex h-full min-h-[96px] flex-col items-center justify-center px-3 py-2 text-center text-[11px] leading-5 text-slate-400">
              <span className="font-bold uppercase tracking-wider text-slate-300">
                No Unit or Structure Selected
              </span>
              <span>
                Click any allied ship to inspect or refit, or click a Shipyard /
                Workshop to queue vessels and repairs.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
