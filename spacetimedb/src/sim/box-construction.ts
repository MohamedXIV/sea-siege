import {
  structureDefinition, validateStructurePlacement,
  type BuildRequest, type StructureShape, type StructureKind,
} from "./construction.ts";

/** Prevent enormous atomic database transactions from a single drag. */
export const MAX_BOX_CONSTRUCTION = 64;

export type BuildCell = Readonly<{ gridX: number; gridY: number }>;
export type BoxPlan = Readonly<{
  cells: readonly BuildCell[];
  reason: string | null;
}>;

/**
 * Both server and preview use the same deterministic rectangle planner.
 *
 * Endpoints are top-left anchors of a structure footprint. 2x2 structures
 * therefore use anchors spaced two grid cells apart; mismatched endpoints
 * are rejected rather than silently building an incomplete final row.
 *
 * For platforms, planning considers previous proposed platforms as connected
 * COMPLETE for the purpose of validation only, allowing one continuous drag
 * to expand outward from an existing base. In the real DB they are inserted
 * INCOMPLETE and finish via their normal scheduled reducer.
 *
 * This function is pure: it never charges salvage or touches the database.
 */
export function planBoxConstruction(
  request: BuildRequest,
  endX: number,
  endY: number,
): BoxPlan {
  const reject = (reason: string): BoxPlan => ({ cells: [], reason });
  const { kind, gridX: startX, gridY: startY } = request;
  const def = structureDefinition(kind);
  if (!def || kind === "command_core") return reject("Invalid structure kind");
  if (![startX, startY, endX, endY].every(Number.isInteger))
    return reject("Box endpoints must be integer cells");
  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);
  if (dx % def.width || dy % def.height)
    return reject(`Box endpoints must align to ${def.width}×${def.height} footprints`);
  const countX = dx / def.width + 1;
  const countY = dy / def.height + 1;
  const count = countX * countY;
  if (count > MAX_BOX_CONSTRUCTION)
    return reject(`Box building is limited to ${MAX_BOX_CONSTRUCTION} structures`);
  if (request.salvage < count * def.cost)
    return reject(`Insufficient salvage for ${count} structures`);

  // BFS layers from the anchor, with deterministic tie-breaking. A long
  // platform rectangle grows only via cells already connected to the base.
  const directionX = endX >= startX ? 1 : -1;
  const directionY = endY >= startY ? 1 : -1;
  const anchors: BuildCell[] = [];
  for (let iy = 0; iy < countY; iy++) for (let ix = 0; ix < countX; ix++)
    anchors.push({
      gridX: startX + directionX * ix * def.width,
      gridY: startY + directionY * iy * def.height,
    });
  anchors.sort((a, b) => {
    const aSteps = Math.abs(a.gridX - startX) / def.width +
      Math.abs(a.gridY - startY) / def.height;
    const bSteps = Math.abs(b.gridX - startX) / def.width +
      Math.abs(b.gridY - startY) / def.height;
    return aSteps - bSteps || a.gridY - b.gridY || a.gridX - b.gridX;
  });

  const virtual: StructureShape[] = [];
  const result: BuildCell[] = [];
  for (const [i, cell] of anchors.entries()) {
    const reason = validateStructurePlacement({
      ...request, gridX: cell.gridX, gridY: cell.gridY,
      salvage: request.salvage - i * def.cost,
      structures: [...request.structures, ...virtual],
    });
    if (reason) return reject(`Cell (${cell.gridX}, ${cell.gridY}): ${reason}`);
    result.push(cell);
    virtual.push({
      id: -BigInt(i + 1),
      kind: kind as StructureKind,
      ownerSlot: request.ownerSlot,
      gridX: cell.gridX,
      gridY: cell.gridY,
      width: def.width,
      height: def.height,
      // Connected temporary footprint only for atomic batch planning.
      complete: true,
    });
  }
  return { cells: result, reason: null };
}
