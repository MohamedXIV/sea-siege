import { COMBAT_RULES } from "../../../spacetimedb/src/sim/combat.ts";
import { ECONOMY_RULES } from "../../../spacetimedb/src/sim/economy.ts";
import { WORKSHOP_RULES, type WorkshopTier } from "../../../spacetimedb/src/sim/workshop.ts";

/** Only real operational radii, shared by placement and selection overlays. */
export function structureInfluenceRange(kind: string, level = 1): number | null {
  if (kind === "salvage_rig") return ECONOMY_RULES.rigRangeCells;
  if (kind === "cannon") return Math.min(
    COMBAT_RULES.weapons.cannon.range, COMBAT_RULES.weapons.cannon.vision,
  );
  if (kind === "workshop") {
    if (level !== 1 && level !== 2 && level !== 3) return null;
    return WORKSHOP_RULES.tiers[level as WorkshopTier].radiusCells;
  }
  return null;
}
