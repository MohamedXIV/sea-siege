import {
  Anchor,
  CircleX,
  Factory,
  Hammer,
  Pickaxe,
  Shield,
} from "lucide-react";
import { spacetimeClient, type SpacetimeClientState } from "@/network/spacetime-client";
import type { GeminiBattleStructure } from "@/module_bindings/types";
import { buildingInfo, buildingMaxHp } from "@/game/buildings/building-info";
import { ECONOMY_RULES } from "../../spacetimedb/src/sim/economy";
import { COMBAT_RULES } from "../../spacetimedb/src/sim/combat";
import {
  WORKSHOP_RULES,
  nextWorkshopUpgrade,
} from "../../spacetimedb/src/sim/workshop";
import {
  RESOURCE_TYPES,
  type AdvancedResourceKind,
} from "../../spacetimedb/src/sim/materials";
import { WorkshopServices } from "@/components/WorkshopServices";

const SHIP_TYPES = ["scout", "gunboat", "siege"] as const;

function condition(complete: boolean, connected: boolean, hp: number): string {
  if (hp <= 0) return "Destroyed";
  if (!complete) return "Under construction";
  if (!connected)
    return "Offline — disconnected from completed friendly platforms";
  return "Operational";
}

export function BuildingInspector({
  state,
  building,
  pending,
  perform,
}: {
  state: SpacetimeClientState;
  building: GeminiBattleStructure;
  pending: boolean;
  perform: (action: () => Promise<void>) => Promise<void>;
}) {
  const own = building.ownerSlot === state.myMembership?.slot;
  const details = buildingInfo(building.kind);
  const ownedRow = own
    ? state.myStructures.find((row) => row.id === building.id)
    : undefined;
  const online = building.complete && building.connected && building.hp > 0;
  const baseHp = buildingMaxHp(building.kind);
  const maxHp =
    baseHp === null
      ? null
      : building.kind === "workshop" && ownedRow
        ? baseHp +
          (WORKSHOP_RULES.tiers[ownedRow.level as 1 | 2 | 3]?.extraMaxHp ?? 0)
        : baseHp;
  const hpPct =
    maxHp && maxHp > 0
      ? Math.max(0, Math.min(100, Math.round((building.hp / maxHp) * 100)))
      : 100;

  const jobs =
    own && building.kind === "shipyard"
      ? state.productionJobs
          .filter((job) => job.yardId === building.id)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      : [];
  const queueFull = jobs.length >= ECONOMY_RULES.shipyardQueueLimit;
  const iron = state.myFaction?.salvage ?? 0;

  const tier = ownedRow?.kind === "workshop" ? ownedRow.level : null;
  const upgrade =
    tier !== null && tier >= 1 && tier <= 3 ? nextWorkshopUpgrade(tier) : null;

  const cx = building.gridX + building.width / 2;
  const cy = building.gridY + building.height / 2;
  const withinRigRange = (x: number, y: number) =>
    Math.hypot(cx - (x + 0.5), cy - (y + 0.5)) <= ECONOMY_RULES.rigRangeCells;
  const ironDeposits = state.salvageNodes.filter(
    (n) => n.remaining > 0 && withinRigRange(n.gridX, n.gridY)
  );
  const advancedDeposits = state.materialDeposits.filter(
    (n) => n.remaining > 0 && withinRigRange(n.gridX, n.gridY)
  );

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#334350] pb-1.5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold uppercase tracking-wider text-amber-100">
              {details.name}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                own
                  ? "bg-cyan-950/70 text-cyan-300"
                  : "bg-rose-950/70 text-rose-300"
              }`}
            >
              {own ? "Yours" : `Faction ${building.ownerSlot + 1}`}
            </span>
          </div>
          <div className="text-[10px] font-semibold text-amber-300/90">
            {details.role}
          </div>
        </div>
        <div className="text-right font-mono text-[10px] text-slate-400">
          <div>
            Tile {building.gridX}, {building.gridY}
          </div>
          <div className={online ? "text-emerald-300" : "text-amber-300"}>
            {condition(building.complete, building.connected, building.hp)}
          </div>
        </div>
      </div>

      {/* Structure HP Bar */}
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-mono text-slate-300">
          HP {building.hp}
          {maxHp ? `/${maxHp}` : ""}
        </span>
        <div className="hud-inset h-2 flex-1 overflow-hidden p-[1px]">
          <div
            className="h-full rounded-[2px] bg-gradient-to-r from-emerald-600 to-emerald-300 transition-all"
            style={{ width: `${hpPct}%` }}
          />
        </div>
      </div>

      <p className="text-[11px] leading-4 text-slate-300">
        {details.description}
      </p>

      {building.kind === "command_core" && (
        <p className="text-[11px] text-emerald-300">
          <Shield className="mr-1 inline size-3" />
          {online
            ? `+ ${ECONOMY_RULES.coreIncomePerSecond} Iron / sec`
            : "Core is not generating Iron"}
        </p>
      )}

      {building.kind === "platform" && (
        <p className="text-[11px] text-slate-300">
          Supports one grid cell. Completed connected platforms allow expansion
          and mounted buildings.
        </p>
      )}

      {building.kind === "salvage_rig" && (
        <div className="hud-inset space-y-1 p-2 text-[11px]">
          <div className="flex items-center gap-1 font-semibold text-emerald-300">
            <Pickaxe className="size-3" /> Extraction radius:{" "}
            {ECONOMY_RULES.rigRangeCells} cells
          </div>
          <div>
            {online
              ? `+ ${ECONOMY_RULES.rigIncomePerSecond} baseline Iron/sec (+${ECONOMY_RULES.rigDepositBonusPerSecond}/sec from deposit).`
              : "Extraction paused while offline or incomplete."}
          </div>
          <div>Iron deposits in range: {ironDeposits.length}</div>
          <div className="flex flex-wrap gap-2">
            {(["oil", "alloy", "isotope"] as const).map((kind) => (
              <span
                key={kind}
                style={{
                  color: RESOURCE_TYPES[kind as AdvancedResourceKind].color,
                }}
              >
                {kind}:{" "}
                {advancedDeposits.filter((node) => node.kind === kind).length}
              </span>
            ))}
          </div>
        </div>
      )}

      {building.kind === "cannon" && (
        <p className="text-[11px] text-slate-300">
          <Shield className="mr-1 inline size-3" />
          Range: {COMBAT_RULES.weapons.cannon.range} cells · Damage:{" "}
          {COMBAT_RULES.weapons.cannon.damage}.{" "}
          {online
            ? "Automatically fires on nearby enemy ships and structures."
            : "Offline until connected and fully built."}
        </p>
      )}

      {building.kind === "workshop" && (
        <div className="hud-inset space-y-1.5 p-2">
          <div className="flex items-center justify-between font-bold text-amber-200">
            <span className="flex items-center gap-1">
              <Hammer className="size-3" /> Workshop {tier ? `Tier ${tier}` : ""}
            </span>
            {tier && (
              <span className="font-mono text-[10px] text-cyan-300">
                Radius {WORKSHOP_RULES.tiers[tier as 1 | 2 | 3]?.radiusCells}{" "}
                cells
              </span>
            )}
          </div>
          {own && ownedRow && (
            <WorkshopServices
              state={state}
              workshop={ownedRow}
              pending={pending}
              perform={perform}
            />
          )}
          {own &&
            ownedRow?.upgradeRemainingUs &&
            ownedRow.upgradeRemainingUs > 0n && (
              <p className="text-amber-300">
                Upgrading ·{" "}
                {Math.ceil(Number(ownedRow.upgradeRemainingUs) / 1_000_000)}s
                remaining
              </p>
            )}
          {own && upgrade && (
            <button
              type="button"
              className="hud-btn rounded px-2.5 py-1 text-[11px] font-bold text-amber-200 disabled:opacity-45"
              disabled={
                pending ||
                !online ||
                !ownedRow ||
                ownedRow.upgradeRemainingUs > 0n ||
                iron < upgrade.cost
              }
              onClick={() =>
                void perform(() => spacetimeClient.upgradeWorkshop(building.id))
              }
            >
              Upgrade to Tier {(tier ?? 1) + 1} · {upgrade.cost} Iron
            </button>
          )}
          {own && tier === 3 && (
            <p className="text-emerald-300">Maximum Workshop tier reached.</p>
          )}
        </div>
      )}

      {building.kind === "shipyard" && (
        <div className="hud-inset space-y-2 p-2">
          <div className="flex items-center justify-between font-bold text-amber-200">
            <span className="flex items-center gap-1">
              <Factory className="size-3" /> Shipyard Production
            </span>
            {own && (
              <span className="font-mono text-[10px] text-slate-300">
                Queue {jobs.length}/{ECONOMY_RULES.shipyardQueueLimit}
              </span>
            )}
          </div>
          {!own ? (
            <p className="text-[11px] text-slate-400">
              Enemy shipyard. Its private production orders are not visible to
              you.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {SHIP_TYPES.map((kind) => {
                  const rule = ECONOMY_RULES.ships[kind];
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="hud-btn flex flex-col items-start rounded px-2 py-1.5 text-left text-[10px] disabled:opacity-45"
                      disabled={
                        pending || !online || queueFull || iron < rule.cost
                      }
                      onClick={() =>
                        void perform(() =>
                          spacetimeClient.enqueueShip(building.id, kind)
                        )
                      }
                    >
                      <span className="flex items-center gap-1 font-bold uppercase text-cyan-200">
                        <Anchor className="size-3" />
                        {kind}
                      </span>
                      <span className="font-mono text-amber-300">
                        {rule.cost} Fe · {rule.buildMs / 1000}s
                      </span>
                    </button>
                  );
                })}
              </div>
              {jobs.length === 0 ? (
                <p className="text-[10px] text-slate-400">
                  No ships queued. Choose a hull above.
                </p>
              ) : (
                <ol className="space-y-1">
                  {jobs.map((job, index) => {
                    const rule =
                      ECONOMY_RULES.ships[
                        job.shipKind as keyof typeof ECONOMY_RULES.ships
                      ];
                    const durationUs = BigInt(rule?.buildMs ?? 0) * 1000n;
                    const progress =
                      durationUs > 0n
                        ? Math.max(
                            0,
                            Math.min(
                              100,
                              Math.round(
                                100 *
                                  (1 -
                                    Number(job.remainingUs) /
                                      Number(durationUs))
                              )
                            )
                          )
                        : 0;
                    const status = !online
                      ? "Paused (offline)"
                      : index > 0 || job.startedAtUs === 0n
                        ? "Queued"
                        : job.remainingUs === 0n
                          ? "Awaiting clear launch water"
                          : `Building · ${progress}%`;
                    return (
                      <li
                        key={job.id.toString()}
                        className="flex items-center justify-between gap-2 rounded border border-[#334350] bg-[#14202b] p-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold uppercase text-slate-100">
                            {index + 1}. {job.shipKind}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {status}
                          </div>
                          {index === 0 &&
                            progress > 0 &&
                            progress < 100 &&
                            online && (
                              <div className="mt-1 h-1.5 w-full rounded bg-slate-800">
                                <div
                                  className="h-full rounded bg-amber-400"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            )}
                        </div>
                        <button
                          type="button"
                          className="hud-btn flex items-center gap-1 rounded px-2 py-1 text-[10px] text-rose-300 disabled:opacity-45"
                          disabled={pending}
                          onClick={() =>
                            void perform(() =>
                              spacetimeClient.cancelShipProduction(job.id)
                            )
                          }
                        >
                          <CircleX className="size-3" /> Cancel
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
