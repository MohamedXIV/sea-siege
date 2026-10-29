/**
 * Seeded world generation, ported from the Gemini gameplay reference.
 * Pure TypeScript: no rendering, network, database, or wall clock access.
 * All map cell writes finish BEFORE chunk encoding (the old prototype's bug).
 */
export const TERRAIN = {
  DEEP_WATER: 0,
  SHALLOW_WATER: 1,
  RUINED_PILLAR: 2,
  WRECKAGE_SHOAL: 3,
} as const;

export const WORLD_RULES = {
  chunkSize: 16,
  coreWidth: 3,
  coreHeight: 3,
  localResourceCapacity: 850,
  contestedResourceCapacity: 1400,
} as const;

export type Spawn = Readonly<{ slotIndex: number; gridX: number; gridY: number; angle: number }>;
export type ResourceDeposit = Readonly<{
  nodeId: number;
  gridX: number;
  gridY: number;
  capacity: number;
  regenPerSec: number;
  contested: boolean;
}>;
export type WorldChunk = Readonly<{
  chunkX: number;
  chunkY: number;
  terrain: readonly number[];
}>;
export type GeneratedWorld = Readonly<{
  seed: number;
  mapCells: number;
  slotCount: number;
  cells: Uint8Array;
  spawns: readonly Spawn[];
  deposits: readonly ResourceDeposit[];
  chunks: readonly WorldChunk[];
}>;

/** The approved 2/4/6/8 presets, with intermediate player counts mapping upward. */
export function cellsForSlots(slots: number): number {
  if (!Number.isInteger(slots) || slots < 2 || slots > 8) throw new RangeError("slot count must be 2–8");
  if (slots <= 2) return 56;
  if (slots <= 4) return 64;
  if (slots <= 6) return 72;
  return 80;
}

export function createSeededRng(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be uint32");
  let state = seed || 0x1337beef;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDeterministicWorld(seed: number, slots: number): GeneratedWorld {
  const mapCells = cellsForSlots(slots);
  const rng = createSeededRng(seed);
  const cells = new Uint8Array(mapCells * mapCells);
  const center = mapCells / 2;
  const spawnRadius = Math.floor(mapCells * 0.36);
  const spawns: Spawn[] = [];

  for (let i = 0; i < slots; i++) {
    const angle = (i * 2 * Math.PI) / slots + Math.PI / 4;
    const sx = Math.round(center + Math.cos(angle) * spawnRadius) - 1;
    const sy = Math.round(center + Math.sin(angle) * spawnRadius) - 1;
    spawns.push({
      slotIndex: i,
      gridX: Math.max(4, Math.min(mapCells - 7, sx)),
      gridY: Math.max(4, Math.min(mapCells - 7, sy)),
      angle,
    });
  }

  const nearSpawn = (x: number, y: number, distance: number): boolean =>
    spawns.some(s => Math.hypot(x - s.gridX - 1.5, y - s.gridY - 1.5) < distance);
  const inside = (x: number, y: number, margin: number): boolean =>
    x >= margin && y >= margin && x < mapCells - margin && y < mapCells - margin;
  const set = (x: number, y: number, terrain: number): void => { cells[y * mapCells + x] = terrain; };

  // Drowned industrial pylons form a central, imperfectly symmetrical obstacle ring.
  const ringRadius = Math.floor(mapCells * 0.16);
  for (let i = 0; i < Math.max(4, slots); i++) {
    const angle = (i * 2 * Math.PI) / Math.max(4, slots) + (rng() - 0.5) * 0.18;
    const px = Math.round(center + Math.cos(angle) * ringRadius);
    const py = Math.round(center + Math.sin(angle) * ringRadius);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, y = py + dy;
      if (inside(x, y, 2) && !nearSpawn(x, y, 8)) {
        set(x, y, Math.abs(dx) + Math.abs(dy) <= 1 || rng() < 0.45
          ? TERRAIN.RUINED_PILLAR : TERRAIN.SHALLOW_WATER);
      }
    }
  }

  // Symmetric wreckage shoals; the local seed chooses placement, not client RNG.
  for (let i = 0; i < Math.floor(mapCells / 6); i++) {
    const distance = (0.22 + rng() * 0.24) * mapCells;
    const baseAngle = rng() * Math.PI;
    for (let mirror = 0; mirror < 2; mirror++) {
      const angle = baseAngle + mirror * Math.PI;
      const x = Math.round(center + Math.cos(angle) * distance);
      const y = Math.round(center + Math.sin(angle) * distance);
      if (!inside(x, y, 3) || nearSpawn(x, y, 9)) continue;
      set(x, y, TERRAIN.WRECKAGE_SHOAL);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ox, ny = y + oy;
        if (cells[ny * mapCells + nx] === TERRAIN.DEEP_WATER) set(nx, ny, TERRAIN.SHALLOW_WATER);
      }
    }
  }

  const deposits: ResourceDeposit[] = [];
  const used = new Set<number>();
  function addDeposit(x: number, y: number, capacity: number, regenPerSec: number, contested: boolean): void {
    if (!inside(x, y, 2)) throw new Error("resource deposit generated outside map bounds");
    const key = y * mapCells + x;
    if (used.has(key)) throw new Error("duplicate resource deposit coordinate");
    used.add(key);
    set(x, y, TERRAIN.SHALLOW_WATER);
    deposits.push({ nodeId: deposits.length + 1, gridX: x, gridY: y, capacity, regenPerSec, contested });
  }

  for (const spawn of spawns) {
    const cx = spawn.gridX + 1.5, cy = spawn.gridY + 1.5;
    const inward = Math.atan2(center - cy, center - cx);
    for (const [distance, offset] of [[6.5, -0.48], [7.2, 0.48]]) {
      const x = Math.round(cx + Math.cos(inward + offset) * distance);
      const y = Math.round(cy + Math.sin(inward + offset) * distance);
      addDeposit(x, y, WORLD_RULES.localResourceCapacity, 2, false);
    }
  }
  for (let i = 0; i < Math.max(4, slots); i++) {
    const angle = (i * 2 * Math.PI) / Math.max(4, slots);
    const distance = Math.floor(mapCells * 0.09);
    addDeposit(
      Math.round(center + Math.cos(angle) * distance),
      Math.round(center + Math.sin(angle) * distance),
      WORLD_RULES.contestedResourceCapacity, 4, true,
    );
  }

  // Encode AFTER all terrain modifications; pad partial chunks to a fixed 16² array.
  const chunks: WorldChunk[] = [];
  const chunkCount = Math.ceil(mapCells / WORLD_RULES.chunkSize);
  for (let cy = 0; cy < chunkCount; cy++) for (let cx = 0; cx < chunkCount; cx++) {
    const terrain: number[] = [];
    for (let ly = 0; ly < WORLD_RULES.chunkSize; ly++) for (let lx = 0; lx < WORLD_RULES.chunkSize; lx++) {
      const x = cx * WORLD_RULES.chunkSize + lx;
      const y = cy * WORLD_RULES.chunkSize + ly;
      terrain.push(x < mapCells && y < mapCells ? cells[y * mapCells + x]! : TERRAIN.DEEP_WATER);
    }
    chunks.push({ chunkX: cx, chunkY: cy, terrain });
  }
  return { seed, mapCells, slotCount: slots, cells, spawns, deposits, chunks };
}
