import { withinWorkshopRange } from "./workshop.ts";
import { shipDefinition } from "./economy.ts";

/** Physical, current-match eligibility shared by Human and Bot refit actions. */
export type RefitStation = Readonly<{
  matchId: bigint; ownerSlot: number; kind: string; complete: boolean;
  connected: boolean; hp: number; upgradeRemainingUs: bigint; level: number;
  gridX: number; gridY: number; width: number; height: number;
}>;
export type RefitVessel = Readonly<{
  matchId: bigint; ownerSlot: number; kind: string;
  hp: number; x: number; y: number;
  velocityX: number; velocityY: number;
}>;

export function validateRefitStation(
  matchId: bigint, slot: number,
  workshop: RefitStation | null, ship: RefitVessel | null,
  hasRoute: boolean,
): string | null {
  if (!workshop || !ship || workshop.matchId !== matchId ||
      ship.matchId !== matchId ||
      ship.ownerSlot !== slot || workshop.ownerSlot !== slot)
    return "Refit requires your own ship and Workshop";
  if (workshop.kind !== "workshop" || !workshop.complete ||
      !workshop.connected || workshop.hp <= 0 ||
      workshop.upgradeRemainingUs > 0n)
    return "Workshop offline or upgrading";
  if (!shipDefinition(ship.kind) || ship.hp <= 0)
    return "Ship unavailable for refit";
  const center = {
    x: workshop.gridX + workshop.width / 2,
    y: workshop.gridY + workshop.height / 2,
  };
  if (!withinWorkshopRange(center, { x: ship.x, y: ship.y }, workshop.level))
    return "Bring the ship within Workshop range";
  if (hasRoute || Math.hypot(ship.velocityX, ship.velocityY) > 0.01)
    return "Stop the ship before refitting";
  return null;
}
