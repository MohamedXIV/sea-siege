/**
 * Pure right-click intent resolution for the combat slice. Kept out of Phaser
 * so the priority rules (hostile unit/building, salvage, water) are testable
 * without a renderer. The server remains the final authority for every order.
 */
import type { ClickableStructure } from "./structure-selection.ts";
import { selectStructureAt } from "./structure-selection.ts";

export type CommandShip = Readonly<{
  id: bigint;
  ownerSlot: number;
  x: number;
  y: number;
  radiusCells: number;
}>;

export type CommandStructure = ClickableStructure & Readonly<{ ownerSlot: number }>;

export type CommandSalvage = Readonly<{
  id: bigint;
  gridX: number;
  gridY: number;
  remaining: number;
}>;

export type RightClickCommand =
  | Readonly<{
      kind: "attack";
      targetType: "ship" | "structure";
      targetId: bigint;
      x: number;
      y: number;
    }>
  | Readonly<{ kind: "salvage"; nodeId: bigint; gridX: number; gridY: number }>
  | Readonly<{ kind: "move"; x: number; y: number }>;

/**
 * Hostile ships win over buildings, and both win over salvage/water. Friendly
 * entities deliberately fall through to a move so a player can reposition
 * without accidentally issuing an invalid attack order.
 */
export function resolveRightClickCommand(
  point: Readonly<{ x: number; y: number }>,
  ownSlot: number | undefined,
  ships: readonly CommandShip[],
  structures: readonly CommandStructure[],
  salvage: readonly CommandSalvage[],
): RightClickCommand {
  const move = { kind: "move" as const, x: point.x, y: point.y };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      ownSlot === undefined || !Number.isInteger(ownSlot)) return move;

  let hostileShip: CommandShip | null = null;
  let hostileDistance = Infinity;
  for (const ship of ships) {
    if (ship.ownerSlot === ownSlot) continue;
    const distance = Math.hypot(point.x - ship.x, point.y - ship.y);
    if (distance <= ship.radiusCells + 0.45 && distance < hostileDistance) {
      hostileShip = ship;
      hostileDistance = distance;
    }
  }
  if (hostileShip) {
    return {
      kind: "attack", targetType: "ship", targetId: hostileShip.id,
      x: hostileShip.x, y: hostileShip.y,
    };
  }

  const hit = selectStructureAt(point.x, point.y, structures);
  const structure = hit ? structures.find(s => s.id === hit.id) ?? null : null;
  if (structure && structure.ownerSlot !== ownSlot) {
    return {
      kind: "attack", targetType: "structure", targetId: structure.id,
      x: structure.gridX + structure.width / 2,
      y: structure.gridY + structure.height / 2,
    };
  }

  const node = salvage.find(n =>
    n.remaining > 0 && Math.abs(point.x - n.gridX - 0.5) < 0.8 &&
    Math.abs(point.y - n.gridY - 0.5) < 0.8);
  if (node) return { kind: "salvage", nodeId: node.id, gridX: node.gridX, gridY: node.gridY };

  return move;
}
