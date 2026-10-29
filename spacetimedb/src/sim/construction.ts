import { TERRAIN } from './worldgen.ts';

/** Balance and footprints adapted from the archived Gemini design, not its fake server. */
export const CONSTRUCTION_RULES = {
  startingSalvage: 420,
  startingPlatformOffsets: [[0, 3], [1, 3], [2, 3], [0, 4], [1, 4], [2, 4]] as const,
  definitions: {
    command_core: { channel: 'surface', width: 3, height: 3, cost: 0, buildMs: 0, hp: 2200 },
    platform: { channel: 'surface', width: 1, height: 1, cost: 25, buildMs: 1500, hp: 280 },
    workshop: { channel: 'superstructure', width: 2, height: 2, cost: 120, buildMs: 5000, hp: 680 },
    shipyard: { channel: 'superstructure', width: 2, height: 2, cost: 150, buildMs: 6000, hp: 820 },
    cannon: { channel: 'superstructure', width: 1, height: 1, cost: 95, buildMs: 4000, hp: 460 },
    salvage_rig: { channel: 'superstructure', width: 2, height: 2, cost: 110, buildMs: 4500, hp: 560 },
  },
} as const;

export type StructureKind = keyof typeof CONSTRUCTION_RULES.definitions;
export type StructureChannel = 'surface' | 'superstructure';
export type StructureShape = Readonly<{
  id: bigint;
  ownerSlot: number;
  kind: StructureKind;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  complete: boolean;
}>;
export type SurfaceCell = Readonly<{ x: number; y: number }>;
export type Hull = Readonly<{ x: number; y: number; radius: number }>;
export type BuildRequest = Readonly<{
  kind: StructureKind;
  ownerSlot: number;
  gridX: number;
  gridY: number;
  salvage: number;
  mapCells: number;
  terrain: Uint8Array;
  structures: readonly StructureShape[];
  deposits: readonly SurfaceCell[];
  hulls: readonly Hull[];
}>;

export function structureDefinition(kind: string) {
  return Object.prototype.hasOwnProperty.call(CONSTRUCTION_RULES.definitions, kind)
    ? CONSTRUCTION_RULES.definitions[kind as StructureKind] : null;
}

const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const key = (x: number, y: number, mapCells: number) => y * mapCells + x;
const inside = (x: number, y: number, size: number) => x >= 0 && y >= 0 && x < size && y < size;

/** Dense occupancy indexes built from authoritative structures; no independent stale map. */
export function occupancyIndex(mapCells: number, structures: readonly StructureShape[]) {
  const surface = new Map<number, StructureShape>();
  const mounted = new Map<number, StructureShape>();
  for (const st of structures) {
    const target = structureDefinition(st.kind)?.channel === 'surface' ? surface : mounted;
    for (let dy = 0; dy < st.height; dy++) for (let dx = 0; dx < st.width; dx++) {
      const x = st.gridX + dx, y = st.gridY + dy;
      if (!inside(x, y, mapCells)) throw new Error('Persisted structure extends outside the world');
      const cell = key(x, y, mapCells);
      if (target.has(cell)) throw new Error('Overlapping persisted structure on same layer');
      target.set(cell, st);
    }
  }
  return { surface, mounted };
}

/** Core-anchored, four-neighbor connectivity. Incomplete decks never conduct support. */
export function connectedSurfaceCells(
  mapCells: number, structures: readonly StructureShape[], ownerSlot: number,
): Set<number> {
  const surface = new Map<number, StructureShape>();
  const queue: number[] = [];
  for (const st of structures) {
    if (st.ownerSlot !== ownerSlot || !st.complete || structureDefinition(st.kind)?.channel !== 'surface') continue;
    for (let dy = 0; dy < st.height; dy++) for (let dx = 0; dx < st.width; dx++) {
      const c = key(st.gridX + dx, st.gridY + dy, mapCells);
      surface.set(c, st);
      if (st.kind === 'command_core') queue.push(c);
    }
  }
  const connected = new Set<number>();
  let head = 0;
  while (head < queue.length) {
    const cell = queue[head++]!;
    if (connected.has(cell)) continue;
    connected.add(cell);
    const x = cell % mapCells, y = Math.floor(cell / mapCells);
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx, ny = y + dy;
      const c = key(nx, ny, mapCells);
      if (inside(nx, ny, mapCells) && surface.has(c) && !connected.has(c)) queue.push(c);
    }
  }
  return connected;
}

/** Mounted buildings need every cell supported, even when spanning chunk boundaries. */
export function structureOnline(
  st: StructureShape, structures: readonly StructureShape[], mapCells: number,
): boolean {
  const connected = connectedSurfaceCells(mapCells, structures, st.ownerSlot);
  const idx = occupancyIndex(mapCells, structures).surface;
  for (let dy = 0; dy < st.height; dy++) for (let dx = 0; dx < st.width; dx++) {
    const cell = key(st.gridX + dx, st.gridY + dy, mapCells);
    if (!connected.has(cell)) return false;
    if (structureDefinition(st.kind)?.channel === 'superstructure' &&
        (idx.get(cell)?.kind !== 'platform' || !idx.get(cell)?.complete)) return false;
  }
  return true;
}

function hullIntersectsFootprint(
  x: number, y: number, width: number, height: number, hull: Hull,
): boolean {
  const nearestX = Math.max(x, Math.min(x + width, hull.x));
  const nearestY = Math.max(y, Math.min(y + height, hull.y));
  const dx = nearestX - hull.x, dy = nearestY - hull.y;
  return dx * dx + dy * dy < hull.radius * hull.radius;
}

/** Returns a specific authoritative rejection reason, or null on success. */
export function validateStructurePlacement(req: BuildRequest): string | null {
  const def = structureDefinition(req.kind);
  if (!def || req.kind === 'command_core') return 'Cannot manually construct Command Core or unknown kind';
  const { gridX: x, gridY: y, mapCells: size } = req;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(size) ||
      req.terrain.length !== size * size || x < 1 || y < 1 ||
      x + def.width >= size || y + def.height >= size) return 'Invalid construction footprint';
  if (!Number.isInteger(req.salvage) || req.salvage < def.cost) return 'Insufficient salvage';
  const occupied = occupancyIndex(size, req.structures);
  const connected = connectedSurfaceCells(size, req.structures, req.ownerSlot);
  const deposits = new Set(req.deposits.map(d => key(d.x, d.y, size)));
  let adjacent = false;
  let openWater = false;
  for (let dy = 0; dy < def.height; dy++) for (let dx = 0; dx < def.width; dx++) {
    const cx = x + dx, cy = y + dy, cell = key(cx, cy, size);
    if (req.terrain[cell] !== TERRAIN.DEEP_WATER && req.terrain[cell] !== TERRAIN.SHALLOW_WATER)
      return 'Impassable terrain';
    if (deposits.has(cell)) return 'Salvage deposit occupied';
    if (def.channel === 'surface') {
      if (occupied.surface.has(cell)) return 'Surface cell occupied';
      for (const [ox, oy] of CARDINAL) {
        const nx = cx + ox, ny = cy + oy;
        if (inside(nx, ny, size) && connected.has(key(nx, ny, size))) adjacent = true;
      }
    } else {
      if (occupied.mounted.has(cell)) return 'Mounted cell occupied';
      const support = occupied.surface.get(cell);
      if (!support || support.ownerSlot !== req.ownerSlot || !support.complete ||
          support.kind !== 'platform' || !connected.has(cell))
        return 'Requires complete connected friendly platforms on every cell';
    }
  }
  if (def.channel === 'surface' && !adjacent) return 'Platform must touch connected territory';
  if (def.channel === 'surface' && req.hulls.some(h => hullIntersectsFootprint(x, y, def.width, def.height, h)))
    return 'Cannot construct over a ship';
  if (req.kind === 'shipyard') {
    for (let dy = 0; dy < def.height; dy++) for (let dx = 0; dx < def.width; dx++) {
      const cx = x + dx, cy = y + dy;
      for (const [ox, oy] of CARDINAL) {
        const wx = cx + ox, wy = cy + oy;
        if (!inside(wx, wy, size) || (wx >= x && wx < x + def.width && wy >= y && wy < y + def.height)) continue;
        const cell = key(wx, wy, size);
        if ((req.terrain[cell] === TERRAIN.DEEP_WATER || req.terrain[cell] === TERRAIN.SHALLOW_WATER) &&
            !occupied.surface.has(cell)) openWater = true;
      }
    }
    if (!openWater) return 'Shipyard requires adjacent open water';
  }
  return null;
}

export function initialStructures(slot: number, gridX: number, gridY: number):
  readonly Omit<StructureShape, 'id'>[] {
  const core = CONSTRUCTION_RULES.definitions.command_core;
  return [
    { kind: 'command_core', ownerSlot: slot, gridX, gridY, width: core.width,
      height: core.height, complete: true },
    ...CONSTRUCTION_RULES.startingPlatformOffsets.map(([dx, dy]) => ({
      kind: 'platform' as const, ownerSlot: slot, gridX: gridX + dx, gridY: gridY + dy,
      width: 1, height: 1, complete: true,
    })),
  ];
}
