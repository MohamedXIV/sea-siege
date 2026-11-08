/** Pure RTS marquee selection; the renderer supplies authorized unit positions. */
export type SelectableUnit = Readonly<{
  id: bigint;
  x: number;
  y: number;
  radius: number;
}>;
export type WorldBox = Readonly<{
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}>;

/**
 * Select a ship when its actual circular hull intersects the dragged box.
 * Drag direction does not matter. Empty boxes return [] (clear selection).
 * A normal click uses a separate single-unit hit test.
 */
export function shipsInSelectionBox(
  box: WorldBox,
  ships: readonly SelectableUnit[],
): bigint[] {
  const left = Math.min(box.fromX, box.toX);
  const right = Math.max(box.fromX, box.toX);
  const top = Math.min(box.fromY, box.toY);
  const bottom = Math.max(box.fromY, box.toY);
  return ships.filter(ship => {
    const nearestX = Math.max(left, Math.min(right, ship.x));
    const nearestY = Math.max(top, Math.min(bottom, ship.y));
    const dx = ship.x - nearestX;
    const dy = ship.y - nearestY;
    return dx * dx + dy * dy <= ship.radius * ship.radius;
  }).map(ship => ship.id)
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
