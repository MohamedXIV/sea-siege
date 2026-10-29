/** Server-owned Workshop repair and upgrade transaction contracts. */
import { structureDefinition } from "./construction.ts";
import { shipDefinition, debitSalvage } from "./economy.ts";
import {
  calculateRepair, maximumStructureHp, nextWorkshopUpgrade,
  withinWorkshopRange,
} from "./workshop.ts";
import type { CommandResult, FactionCapability } from "./command-dispatch.ts";

type Workshop = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number; kind: string;
  complete: boolean; connected: boolean; hp: number; level: number;
  upgradeRemainingUs: bigint; gridX: number; gridY: number;
  width: number; height: number;
}>;
type RepairTarget = Readonly<{
  id: bigint; matchId: bigint; ownerSlot: number;
  type: "ship" | "structure"; kind: string; hp: number; level: number;
  complete: boolean; connected: boolean; x: number; y: number;
}>;
const deny = (reason: string): CommandResult => ({ ok: false, reason });
function workshopValid(faction: FactionCapability, workshop: Workshop | null): boolean {
  return !faction.eliminated && !!workshop &&
    workshop.kind === "workshop" && workshop.matchId === faction.matchId &&
    workshop.ownerSlot === faction.slot && workshop.hp > 0 &&
    workshop.complete && workshop.connected;
}
export function dispatchWorkshopRepair(
  params: Readonly<{
    faction: FactionCapability; workshop: Workshop | null;
    target: RepairTarget | null; requestedHp: number; salvage: number;
  }>,
  ports: Readonly<{
    setBalance(value: number): void;
    setTargetHp(targetId: bigint, hp: number): void;
  }>,
): CommandResult {
  const { faction, workshop, target } = params;
  if (!workshopValid(faction,workshop)) return deny("Workshop offline or unavailable");
  if (workshop!.upgradeRemainingUs > 0n) return deny("Workshop offline or upgrading");
  if (!target || target.matchId !== faction.matchId ||
      target.ownerSlot !== faction.slot || target.hp <= 0)
    return deny("Repair target unavailable");
  if (target.type === "structure" && (!target.complete || !target.connected))
    return deny("Structure unavailable for repair");
  const definition = target.type === "ship" ?
    shipDefinition(target.kind) : structureDefinition(target.kind);
  if (!definition) return deny("Invalid repair target kind");
  const workshopCenter = {
    x: workshop!.gridX + workshop!.width / 2,
    y: workshop!.gridY + workshop!.height / 2,
  };
  if (!withinWorkshopRange(workshopCenter,{x:target.x,y:target.y},workshop!.level))
    return deny("Repair target out of range");
  const maxHp = target.type === "ship" ? definition.hp :
    maximumStructureHp(definition.hp,target.level,target.kind);
  // Catch malformed client requests as rejected command, not a partial write.
  if (!Number.isSafeInteger(params.requestedHp) || params.requestedHp <= 0)
    return deny("Invalid requested repair HP");
  if (target.hp >= maxHp) return deny("Target already at full health");
  const result = calculateRepair(target.hp,maxHp,params.requestedHp,workshop!.level);
  if (!Number.isSafeInteger(params.salvage) || params.salvage < result.salvageCost)
    return deny("Insufficient salvage");
  const balance = debitSalvage(params.salvage,result.salvageCost);
  ports.setBalance(balance);
  ports.setTargetHp(target.id,result.newHp);
  return { ok: true };
}
export function dispatchWorkshopUpgrade(
  params: Readonly<{
    faction: FactionCapability; workshop: Workshop | null;
    salvage: number; nowUs: bigint;
  }>,
  ports: Readonly<{
    setBalance(value: number): void;
    setUpgrade(remainingUs: bigint, startedAtUs: bigint): void;
  }>,
): CommandResult {
  const { faction, workshop, nowUs } = params;
  if (!workshopValid(faction,workshop)) return deny("Workshop unavailable");
  if (workshop!.upgradeRemainingUs > 0n) return deny("Workshop already upgrading");
  if (nowUs < 0n) return deny("Invalid server time");
  const next = nextWorkshopUpgrade(workshop!.level);
  if (!next) return deny("Workshop at maximum tier");
  if (!Number.isSafeInteger(params.salvage) || params.salvage < next.cost)
    return deny("Insufficient salvage");
  const balance = debitSalvage(params.salvage,next.cost);
  ports.setBalance(balance);
  ports.setUpgrade(next.durationUs,nowUs);
  return { ok: true };
}
