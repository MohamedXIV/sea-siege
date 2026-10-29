import { TERRAIN } from "./worldgen.ts";

/** Deterministic grid navigation for authoritative RTS orders. No browser state. */
export type GridPoint = Readonly<{ x: number; y: number }>;
export type PathResult = Readonly<{
  waypoints: readonly GridPoint[];
  expanded: number;
  lengthCells: number;
}>;
export type PathOptions = Readonly<{
  clearanceCells?: number;
  maxExpanded?: number;
  /** Server-owned dynamic structures/units may block a destination cell. */
  blocked?: (x: number, y: number) => boolean;
}>;

type OpenNode = { index: number; f: number; h: number };
function compare(a: OpenNode, b: OpenNode): number {
  return a.f - b.f || a.h - b.h || a.index - b.index;
}

/** Binary min-heap: cheap enough for the largest 80x80 board. */
class OpenHeap {
  private items: OpenNode[] = [];
  get size(): number { return this.items.length; }
  push(value: OpenNode): void {
    const a = this.items;
    let i = a.length;
    a.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compare(a[parent]!, value) <= 0) break;
      a[i] = a[parent]!;
      i = parent;
    }
    a[i] = value;
  }
  pop(): OpenNode | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length === 0 || !last) return top;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      if (left >= a.length) break;
      let child = left;
      if (left + 1 < a.length && compare(a[left + 1]!, a[left]!) < 0) child = left + 1;
      if (compare(last, a[child]!) <= 0) break;
      a[i] = a[child]!;
      i = child;
    }
    a[i] = last;
    return top;
  }
}

const DIRECTIONS = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1],
] as const;

/**
 * A* with an admissible octile heuristic, bounded expansions and diagonal
 * corner-cut prevention. The path uses grid cell centers, not pixel coords.
 * Dynamic blockers must be supplied from server-owned occupancy state.
 */
export function findTerrainPath(
  cells: Uint8Array,
  mapCells: number,
  start: GridPoint,
  goal: GridPoint,
  options: PathOptions = {},
): PathResult | null {
  if (!Number.isInteger(mapCells) || mapCells < 2 || cells.length !== mapCells * mapCells) {
    throw new RangeError("invalid navigation map dimensions");
  }
  const clearance = options.clearanceCells ?? 0;
  const limit = options.maxExpanded ?? cells.length;
  if (!Number.isInteger(clearance) || clearance < 0 || !Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("invalid pathfinding budget or clearance");
  }
  const s = { x: Math.floor(start.x), y: Math.floor(start.y) };
  const g = { x: Math.floor(goal.x), y: Math.floor(goal.y) };
  if (![start.x, start.y, goal.x, goal.y].every(Number.isFinite)) return null;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < mapCells && y < mapCells;
  const walkable = (x: number, y: number): boolean => {
    for (let dy = -clearance; dy <= clearance; dy++) {
      for (let dx = -clearance; dx <= clearance; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) return false;
        const tile = cells[ny * mapCells + nx];
        if (tile !== TERRAIN.DEEP_WATER && tile !== TERRAIN.SHALLOW_WATER) return false;
        if (options.blocked?.(nx, ny)) return false;
      }
    }
    return true;
  };
  if (!walkable(s.x, s.y) || !walkable(g.x, g.y)) return null;
  const startId = s.y * mapCells + s.x;
  const goalId = g.y * mapCells + g.x;
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - g.x), dy = Math.abs(y - g.y);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const scores = new Float64Array(cells.length);
  scores.fill(Infinity);
  scores[startId] = 0;
  const prev = new Int32Array(cells.length);
  prev.fill(-1);
  const closed = new Uint8Array(cells.length);
  const open = new OpenHeap();
  open.push({ index: startId, f: h(s.x, s.y), h: h(s.x, s.y) });
  let expanded = 0;

  while (open.size && expanded < limit) {
    const current = open.pop()!;
    if (closed[current.index]) continue;
    closed[current.index] = 1;
    expanded++;
    if (current.index === goalId) {
      const reversed: GridPoint[] = [];
      let id = goalId;
      while (id !== -1) {
        reversed.push({ x: (id % mapCells) + 0.5, y: Math.floor(id / mapCells) + 0.5 });
        id = prev[id]!;
      }
      reversed.reverse();
      return { waypoints: reversed, expanded, lengthCells: scores[goalId]! };
    }
    const x = current.index % mapCells, y = Math.floor(current.index / mapCells);
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || !walkable(nx, ny)) continue;
      // Never sneak diagonally through two touching ruins/buildings.
      if (dx !== 0 && dy !== 0 && (!walkable(x + dx, y) || !walkable(x, y + dy))) continue;
      const neighbor = ny * mapCells + nx;
      if (closed[neighbor]) continue;
      const newCost = scores[current.index]! + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      if (newCost >= scores[neighbor]!) continue;
      scores[neighbor] = newCost;
      prev[neighbor] = current.index;
      const heuristic = h(nx, ny);
      open.push({ index: neighbor, h: heuristic, f: newCost + heuristic });
    }
  }
  return null;
}

export type EncodedTerrainChunk = Readonly<{
  chunkX: number;
  chunkY: number;
  terrain: readonly number[];
}>;

/** Reconstitutes the authoritative map used by route validation from DB chunks. */
export function decodeTerrainChunks(
  mapCells: number,
  chunks: readonly EncodedTerrainChunk[],
  chunkSize = 16,
): Uint8Array {
  if (!Number.isInteger(mapCells) || mapCells < 2 || !Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError("invalid terrain dimensions");
  }
  const expectedCount = Math.ceil(mapCells / chunkSize);
  if (chunks.length !== expectedCount * expectedCount) throw new Error("incomplete terrain chunk set");
  const result = new Uint8Array(mapCells * mapCells);
  const seen = new Uint8Array(expectedCount * expectedCount);
  for (const chunk of chunks) {
    const { chunkX, chunkY, terrain } = chunk;
    if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) ||
        chunkX < 0 || chunkY < 0 || chunkX >= expectedCount || chunkY >= expectedCount ||
        terrain.length !== chunkSize * chunkSize) throw new Error("invalid terrain chunk");
    const chunkId = chunkY * expectedCount + chunkX;
    if (seen[chunkId]) throw new Error("duplicate terrain chunk");
    seen[chunkId] = 1;
    for (let localY = 0; localY < chunkSize; localY++) {
      for (let localX = 0; localX < chunkSize; localX++) {
        const x = chunkX * chunkSize + localX;
        const y = chunkY * chunkSize + localY;
        const tile = terrain[localY * chunkSize + localX]!;
        if (!Number.isInteger(tile) || tile < TERRAIN.DEEP_WATER || tile > TERRAIN.WRECKAGE_SHOAL) {
          throw new Error("unknown terrain value");
        }
        if (x < mapCells && y < mapCells) result[y * mapCells + x] = tile;
      }
    }
  }
  return result;
}
