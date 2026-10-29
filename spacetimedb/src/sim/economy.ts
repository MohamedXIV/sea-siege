import { canSweepVessel, type CollisionEnvironment } from './collision.ts';

/** Gemini-reference starting balance, server-side only. Tune after real matches. */
export const ECONOMY_RULES = {
  tickMicroseconds: 1_000_000n,
  maxElapsedMicroseconds: 5_000_000n,
  maxSalvage: 0xffff_ffff,
  coreIncomePerSecond: 4,
  rigIncomePerSecond: 9,
  rigDepositBonusPerSecond: 11,
  rigRangeCells: 4.5,
  harvestRangeCells: 3.5,
  shipyardQueueLimit: 5,
  shipyardSpawnSearchCells: 4,
  ships: {
    scout: { cost: 70, buildMs: 4_000, harvestPerSecond: 14, radius: 0.42, hp: 210 },
    gunboat: { cost: 130, buildMs: 6_500, harvestPerSecond: 8, radius: 0.56, hp: 460 },
    siege: { cost: 220, buildMs: 9_500, harvestPerSecond: 0, radius: 0.72, hp: 780 },
  },
} as const;
export type ShipKind = keyof typeof ECONOMY_RULES.ships;
export type ResourceDepositState = Readonly<{
  gridX: number; gridY: number; remaining: number; capacity: number; regenPerSec: number;
}>;
export type Coordinate = Readonly<{ x: number; y: number }>;
export type ShipyardRect = Readonly<{ gridX: number; gridY: number; width: number; height: number }>;

export function shipDefinition(kind: string) {
  return Object.prototype.hasOwnProperty.call(ECONOMY_RULES.ships, kind)
    ? ECONOMY_RULES.ships[kind as ShipKind] : null;
}

/** Clamp delayed scheduler work; never replay minutes of missed work at once. */
export function cappedElapsedUs(previousUs: bigint, nowUs: bigint): bigint {
  const elapsed = nowUs - previousUs;
  return elapsed <= 0n ? 0n : elapsed > ECONOMY_RULES.maxElapsedMicroseconds
    ? ECONOMY_RULES.maxElapsedMicroseconds : elapsed;
}

/** Exact integer salvage credit, with explicit u32 saturation and no overflow. */
export function creditSalvage(balance: number, earned: number): number {
  if (![balance, earned].every(Number.isSafeInteger) || balance < 0 || earned < 0 ||
      balance > ECONOMY_RULES.maxSalvage) throw new RangeError('invalid salvage');
  return Math.min(ECONOMY_RULES.maxSalvage, balance + earned);
}

export function debitSalvage(balance: number, cost: number): number {
  if (![balance, cost].every(Number.isSafeInteger) || balance < 0 ||
      cost < 0 || balance > ECONOMY_RULES.maxSalvage) throw new RangeError('invalid salvage');
  if (balance < cost) throw new Error('Insufficient salvage');
  return balance - cost;
}

/** A single authoritative node can never yield more salvage than it contains. */
export function drawSalvage(remaining: number, requested: number): { taken: number; remaining: number } {
  if (![remaining, requested].every(Number.isSafeInteger) || remaining < 0 || requested < 0)
    throw new RangeError('invalid salvage draw');
  const taken = Math.min(remaining, requested);
  return { taken, remaining: remaining - taken };
}

export function replenishSalvage(node: ResourceDepositState, seconds: number): number {
  if (![node.remaining, node.capacity, node.regenPerSec, seconds].every(Number.isSafeInteger) ||
      seconds < 0 || node.remaining < 0 || node.capacity < 0 || node.regenPerSec < 0 ||
      node.remaining > node.capacity) throw new RangeError('invalid node regeneration');
  return Math.min(node.capacity, node.remaining + node.regenPerSec * seconds);
}

export function inRange(a: Coordinate, b: Coordinate, range: number): boolean {
  if (![a.x, a.y, b.x, b.y, range].every(Number.isFinite) || range < 0) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= range;
}

/** Rig gets base income when online; extra income is drawn from a nearby deposit. */
export function rigExtraction(remaining: number, seconds: number) {
  const bonus = drawSalvage(remaining, ECONOMY_RULES.rigDepositBonusPerSecond * seconds);
  return {
    earned: ECONOMY_RULES.rigIncomePerSecond * seconds + bonus.taken,
    takenFromNode: bonus.taken,
    remaining: bonus.remaining,
  };
}

/** A yard has exactly one active job; offline structures make zero progress. */
export function advanceProduction(remainingUs: bigint, elapsedUs: bigint, operational: boolean): bigint {
  if (remainingUs < 0n || elapsedUs < 0n) throw new RangeError('negative production work');
  return operational ? (elapsedUs >= remainingUs ? 0n : remainingUs - elapsedUs) : remainingUs;
}

/** Deterministic, bounded safe-water launch search; queues wait when every berth is blocked. */
export function findShipyardSpawn(
  yard: ShipyardRect, kind: ShipKind, environment: CollisionEnvironment,
): Coordinate | null {
  const definition = ECONOMY_RULES.ships[kind];
  if (!definition || ![yard.gridX, yard.gridY, yard.width, yard.height].every(Number.isInteger) ||
      yard.width <= 0 || yard.height <= 0) throw new RangeError('invalid shipyard');
  const candidates: { x: number; y: number; distance: number }[] = [];
  const centerX = yard.gridX + yard.width / 2;
  const centerY = yard.gridY + yard.height / 2;
  for (let ring = 1; ring <= ECONOMY_RULES.shipyardSpawnSearchCells; ring++) {
    for (let y = yard.gridY - ring; y < yard.gridY + yard.height + ring; y++) {
      for (let x = yard.gridX - ring; x < yard.gridX + yard.width + ring; x++) {
        if (x !== yard.gridX - ring && x !== yard.gridX + yard.width + ring - 1 &&
            y !== yard.gridY - ring && y !== yard.gridY + yard.height + ring - 1) continue;
        const px = x + 0.5, py = y + 0.5;
        const distance = Math.hypot(px - centerX, py - centerY);
        candidates.push({ x: px, y: py, distance });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  for (const point of candidates) {
    if (canSweepVessel(point, point, definition.radius, environment))
      return { x: point.x, y: point.y };
  }
  return null;
}
