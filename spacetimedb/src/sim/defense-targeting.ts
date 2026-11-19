import { terrainLineOfSight, weaponDefinition, type Point } from "./combat.ts";
import type { AttackableTarget } from "./attack-order.ts";

/**
 * Shared autonomous defense target selection. Ships and fixed cannons call the
 * same aim/fire dispatchers once a valid target is selected.
 * All positions/visibility are from the authoritative match snapshot.
 */
export function chooseDefenseTarget(
  source: Readonly<{ ownerSlot: number; kind: string; x: number; y: number }>,
  candidates: readonly AttackableTarget[],
  terrain: Uint8Array,
  mapCells: number,
): AttackableTarget | null {
  const weapon = weaponDefinition(source.kind);
  if (!weapon) return null;
  const origin: Point = { x: source.x, y: source.y };
  const radius = Math.min(weapon.range, weapon.vision);
  let best: AttackableTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of candidates) {
    if (target.hp <= 0 || target.ownerSlot === source.ownerSlot) continue;
    const d = Math.hypot(target.x - source.x, target.y - source.y);
    if (!Number.isFinite(d) || d <= 0 || d > radius) continue;
    if (!terrainLineOfSight(origin, target, terrain, mapCells)) continue;
    if (!best || d < bestDistance - 1e-8 ||
        (Math.abs(d - bestDistance) <= 1e-8 &&
          (target.type === "ship" && best.type !== "ship" ||
           target.type === best.type && target.id < best.id))) {
      best = target;
      bestDistance = d;
    }
  }
  return best;
}
