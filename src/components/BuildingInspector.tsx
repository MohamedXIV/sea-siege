import { Anchor, CircleX, Factory, Hammer, Pickaxe, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spacetimeClient, type SpacetimeClientState } from "@/network/spacetime-client";
import type { GeminiBattleStructure } from "@/module_bindings/types";
import { buildingInfo, buildingMaxHp } from "@/game/buildings/building-info";
import { ECONOMY_RULES } from "../../spacetimedb/src/sim/economy";
import { COMBAT_RULES } from "../../spacetimedb/src/sim/combat";
import { WORKSHOP_RULES, nextWorkshopUpgrade } from "../../spacetimedb/src/sim/workshop";
import { RESOURCE_TYPES, type AdvancedResourceKind } from "../../spacetimedb/src/sim/materials";

const SHIP_TYPES = ["scout", "gunboat", "siege"] as const;

function condition(complete: boolean, connected: boolean, hp: number): string {
  if (hp <= 0) return "Destroyed";
  if (!complete) return "Under construction";
  if (!connected) return "Offline — disconnected from completed friendly platforms";
  return "Operational";
}

export function BuildingInspector({
  state, building, pending, perform,
}: {
  state: SpacetimeClientState;
  building: GeminiBattleStructure;
  pending: boolean;
  perform: (action: () => Promise<void>) => Promise<void>;
}) {
  const own = building.ownerSlot === state.myMembership?.slot;
  const details = buildingInfo(building.kind);
  const ownedRow = own ? state.myStructures.find(row => row.id === building.id) : undefined;
  const online = building.complete && building.connected && building.hp > 0;
  const baseHp = buildingMaxHp(building.kind);
  const maxHp = baseHp === null ? null :
    building.kind === "workshop" && ownedRow
      ? baseHp + (WORKSHOP_RULES.tiers[ownedRow.level as 1 | 2 | 3]?.extraMaxHp ?? 0)
      : baseHp;

  const jobs = own && building.kind === "shipyard"
    ? state.productionJobs.filter(job => job.yardId === building.id)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    : [];
  const queueFull = jobs.length >= ECONOMY_RULES.shipyardQueueLimit;
  const iron = state.myFaction?.salvage ?? 0;

  const tier = ownedRow?.kind === "workshop" ? ownedRow.level : null;
  const upgrade = tier !== null && tier >= 1 && tier <= 3
    ? nextWorkshopUpgrade(tier)
    : null;

  const cx = building.gridX + building.width / 2;
  const cy = building.gridY + building.height / 2;
  const withinRigRange = (x: number, y: number) =>
    Math.hypot(cx - (x + 0.5), cy - (y + 0.5)) <= ECONOMY_RULES.rigRangeCells;
  const ironDeposits = state.salvageNodes.filter(n =>
    n.remaining > 0 && withinRigRange(n.gridX, n.gridY));
  const advancedDeposits = state.materialDeposits.filter(n =>
    n.remaining > 0 && withinRigRange(n.gridX, n.gridY));

  return (
    <div className="space-y-2 text-xs">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-white">{details.name}</span>
          <span className={own ? "text-cyan-300" : "text-rose-300"}>
            {own ? "Yours" : `Faction ${building.ownerSlot + 1}`}
          </span>
        </div>
        <div className="text-[11px] font-semibold text-sky-300">{details.role}</div>
        <p className="mt-1 text-[11px] leading-4 text-slate-300">{details.description}</p>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <span>HP {building.hp}{maxHp ? ` / ${maxHp}` : ""}</span>
        <span className={online ? "text-emerald-300" : "text-amber-300"}>
          {condition(building.complete, building.connected, building.hp)}
        </span>
        <span>Tile {building.gridX}, {building.gridY}</span>
      </div>

      {building.kind === "command_core" && (
        <p className="text-[11px] text-emerald-300">
          <Shield className="mr-1 inline size-3" />
          {online ? `+ ${ECONOMY_RULES.coreIncomePerSecond} Iron / sec` : "Core is not generating Iron"}
        </p>
      )}

      {building.kind === "platform" && (
        <p className="text-[11px] text-slate-300">
          Supports one grid cell. Completed connected platforms allow expansion and mounted buildings.
          Platforms do not produce resources or ships.
        </p>
      )}

      {building.kind === "salvage_rig" && (
        <div className="space-y-1 rounded border border-slate-700/70 bg-slate-900/50 p-2 text-[11px]">
          <div className="flex items-center gap-1 font-semibold text-emerald-300">
            <Pickaxe className="size-3" /> Extraction radius: {ECONOMY_RULES.rigRangeCells} cells
          </div>
          <div>
            {online
              ? `+ ${ECONOMY_RULES.rigIncomePerSecond} baseline Iron/sec; up to ${ECONOMY_RULES.rigDepositBonusPerSecond} extra Iron/sec from an in-range Iron deposit.`
              : "Extraction paused while the structure is offline or incomplete."}
          </div>
          <div>
            Advanced materials: up to 8 total/sec, capped at 4 from each in-range deposit,
            subject to remaining reserves.
          </div>
          <div>Iron deposits in range: {ironDeposits.length}</div>
          <div className="flex flex-wrap gap-2">
            {(["oil", "alloy", "isotope"] as const).map(kind => (
              <span key={kind} style={{ color: RESOURCE_TYPES[kind as AdvancedResourceKind].color }}>
                {kind}: {advancedDeposits.filter(node => node.kind === kind).length}
              </span>
            ))}
          </div>
        </div>
      )}

      {building.kind === "cannon" && (
        <p className="text-[11px] text-slate-300">
          <Shield className="mr-1 inline size-3" />
          Cannon range: {COMBAT_RULES.weapons.cannon.range} cells · Base damage: {COMBAT_RULES.weapons.cannon.damage}.
          Combat targeting controls are being expanded; this is not a ship-production building.
        </p>
      )}

      {building.kind === "workshop" && (
        <div className="space-y-1.5 rounded border border-slate-700/70 bg-slate-900/50 p-2">
          <div className="flex items-center gap-1 font-semibold text-cyan-200">
            <Hammer className="size-3" /> Workshop {tier ? `Tier ${tier}` : ""}
          </div>
          <p className="text-[11px] text-slate-300">
            {tier ? `Repair radius: ${WORKSHOP_RULES.tiers[tier as 1 | 2 | 3]?.radiusCells} cells. ` : ""}
            Select a ship near an operational Workshop for Oil/Alloy refits.
            The server also supports ship and structure repairs.
          </p>
          {own && ownedRow?.upgradeRemainingUs && ownedRow.upgradeRemainingUs > 0n && (
            <p className="text-amber-300">
              Upgrading · {Math.ceil(Number(ownedRow.upgradeRemainingUs) / 1_000_000)}s remaining
            </p>
          )}
          {own && upgrade && (
            <Button size="sm" variant="outline" className="h-8 border-slate-700 text-xs"
              disabled={pending || !online || !ownedRow ||
                ownedRow.upgradeRemainingUs > 0n || iron < upgrade.cost}
              onClick={() => void perform(() => spacetimeClient.upgradeWorkshop(building.id))}
            >
              Upgrade to Tier {(tier ?? 1) + 1} · {upgrade.cost} Iron
            </Button>
          )}
          {own && tier === 3 && (
            <p className="text-emerald-300">Maximum Workshop tier reached.</p>
          )}
        </div>
      )}

      {building.kind === "shipyard" && (
        <div className="space-y-2 rounded border border-slate-700/70 bg-slate-900/50 p-2">
          <div className="flex items-center gap-1 font-bold text-cyan-200">
            <Factory className="size-3" /> Shipyard Production
          </div>
          {!own ? (
            <p className="text-[11px] text-slate-400">
              Enemy shipyard. Its private production orders are not visible to you.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-slate-300">
                {online ? "Ready to queue combat ships." :
                  "Production is paused until construction finishes and the Shipyard is connected."}
                {" "}One ship is built at a time; launch requires open navigable water nearby.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SHIP_TYPES.map(kind => {
                  const rule = ECONOMY_RULES.ships[kind];
                  return (
                    <Button key={kind} size="sm" variant="outline"
                      className="h-auto min-h-10 flex-col items-start border-slate-700 px-2 py-1 text-[11px]"
                      disabled={pending || !online || queueFull || iron < rule.cost}
                      onClick={() => void perform(() => spacetimeClient.enqueueShip(building.id, kind))}>
                      <span><Anchor className="mr-1 inline size-3" />{kind.toUpperCase()}</span>
                      <span className="text-amber-300">{rule.cost} Iron · {rule.buildMs / 1000}s</span>
                    </Button>
                  );
                })}
              </div>
              <div className="text-[11px] text-slate-300">
                Queue: {jobs.length} / {ECONOMY_RULES.shipyardQueueLimit}
                {queueFull ? " · Full" : ""}
                {iron < ECONOMY_RULES.ships.scout.cost ? " · Not enough Iron for a Scout" : ""}
              </div>
              {jobs.length === 0 ? (
                <p className="text-[11px] text-slate-400">No ships queued. Choose a hull above.</p>
              ) : (
                <ol className="space-y-1">
                  {jobs.map((job, index) => {
                    const rule = ECONOMY_RULES.ships[job.shipKind as keyof typeof ECONOMY_RULES.ships];
                    const durationUs = BigInt(rule?.buildMs ?? 0) * 1000n;
                    const progress = durationUs > 0n
                      ? Math.max(0, Math.min(100, Math.round(
                          100 * (1 - Number(job.remainingUs) / Number(durationUs)))))
                      : 0;
                    const status = !online ? "Paused (offline)" :
                      index > 0 || job.startedAtUs === 0n ? "Queued" :
                      job.remainingUs === 0n ? "Awaiting clear launch water" :
                      `Building · ${progress}%`;
                    return (
                      <li key={job.id.toString()} className="flex items-center justify-between gap-2 rounded bg-slate-800/70 p-1.5">
                        <div className="min-w-0">
                          <div className="font-semibold">{index + 1}. {job.shipKind.toUpperCase()}</div>
                          <div className="text-[10px] text-slate-400">{status}</div>
                          {index === 0 && progress > 0 && progress < 100 && online && (
                            <div className="mt-1 h-1 w-32 max-w-full rounded bg-slate-700">
                              <div className="h-1 rounded bg-cyan-400" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                        <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-300"
                          disabled={pending}
                          onClick={() => void perform(() => spacetimeClient.cancelShipProduction(job.id))}>
                          <CircleX className="size-3" /> Cancel
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {jobs.some(job => job.remainingUs === 0n) && (
                <p className="text-[11px] text-amber-300">
                  Clear nearby launch water by moving ships away if a completed order cannot launch.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
