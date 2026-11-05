import { dominanceScore5 } from "./match-outcome.ts";

export type StandingFaction = Readonly<{
  slot: number;
  controller: string;
  eliminated: boolean;
  totalSalvageGathered: bigint;
}>;
export type StandingStructure = Readonly<{
  ownerSlot: number;
  kind: string;
  hp: number;
}>;
export type StandingShip = Readonly<{
  ownerSlot: number;
  hp: number;
}>;
export type StandingMaterial = Readonly<{
  ownerSlot: number;
  totalGathered: bigint;
}>;

export type FinalStanding = Readonly<{
  slot: number;
  controller: string;
  eliminated: boolean;
  coreHp: number;
  structures: number;
  ships: number;
  ironGathered: bigint;
  advancedGathered: bigint;
  score5: bigint;
}>;

/**
 * Stable final state as seen by the server, not reconstructed after the
 * finished match's private world views disappear. This is a *snapshot*,
 * written exactly once on either destruction victory or time-limit ending.
 * Iron is the existing Salvage scoring currency; advanced gathering is shown
 * as a separate honest stat, not silently added to Gemini's score formula.
 */
export function calculateFinalStandings(
  factions: readonly StandingFaction[],
  structures: readonly StandingStructure[],
  ships: readonly StandingShip[],
  materials: readonly StandingMaterial[],
): FinalStanding[] {
  const seen = new Set<number>();
  return [...factions].sort((a, b) => a.slot - b.slot).map(faction => {
    if (!Number.isSafeInteger(faction.slot) || faction.slot < 0 ||
        seen.has(faction.slot)) throw new RangeError("Invalid or duplicate faction slot");
    seen.add(faction.slot);
    const occupied = structures.filter(row => row.ownerSlot === faction.slot && row.hp > 0);
    const coreHp = occupied.filter(row => row.kind === "command_core")
      .reduce((sum, row) => sum + row.hp, 0);
    const aliveShips = ships.filter(row => row.ownerSlot === faction.slot && row.hp > 0).length;
    const advancedGathered = materials
      .filter(row => row.ownerSlot === faction.slot)
      .reduce((sum, row) => sum + row.totalGathered, 0n);
    return {
      slot: faction.slot,
      controller: faction.controller,
      eliminated: faction.eliminated || coreHp === 0,
      coreHp,
      structures: occupied.length,
      ships: aliveShips,
      ironGathered: faction.totalSalvageGathered,
      advancedGathered,
      score5: dominanceScore5({
        slot: faction.slot, coreHp, structures: occupied.length,
        ships: aliveShips, totalSalvageGathered: faction.totalSalvageGathered,
      }),
    };
  });
}

/**
 * Only the winnerSlot and victoryReason on the public match row determine
 * victory. Scores are informational and must not locally overturn the result.
 */
export function matchResultForSlot(
  phase: string, winnerSlot: number, mySlot: number | null,
): "pending" | "victory" | "defeat" | "draw" | "spectator" {
  if (phase !== "finished") return "pending";
  if (mySlot === null) return "spectator";
  if (winnerSlot === -1) return "draw";
  return winnerSlot === mySlot ? "victory" : "defeat";
}
