import { TERRAIN } from './worldgen.ts';

/** Coordinates and radii are in cells. Obstacles are server-owned data. */
export type WorldPoint = Readonly<{ x: number; y: number }>;
export type Footprint = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type VesselBody = Readonly<{ id: bigint; x: number; y: number; radius: number }>;
export type CollisionEnvironment = Readonly<{
  mapCells: number;
  terrain: Uint8Array;
  footprints?: readonly Footprint[];
  vessels?: readonly VesselBody[];
}>;

export const COLLISION_RULES = {
  /** Initial conservative hull radius; later tuned per ship class. */
  scoutRadiusCells: 0.28,
  epsilon: 1e-9,
} as const;

function validPoint(point: WorldPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function assertEnvironment(env: CollisionEnvironment, radius: number): void {
  if (!Number.isInteger(env.mapCells) || env.mapCells < 2 ||
      env.terrain.length !== env.mapCells * env.mapCells ||
      !Number.isFinite(radius) || radius < 0 || radius >= 1 ||
      env.footprints?.some(r => !Number.isInteger(r.x) || !Number.isInteger(r.y) ||
        !Number.isInteger(r.width) || !Number.isInteger(r.height) || r.width < 1 || r.height < 1) ||
      env.vessels?.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y) ||
        !Number.isFinite(v.radius) || v.radius < 0)) {
    throw new RangeError('invalid collision environment');
  }
}

/** Slab test of swept ship center against an obstacle conservatively expanded by radius. */
function segmentIntersectsExpandedRect(
  from: WorldPoint, to: WorldPoint, minX: number, minY: number,
  maxX: number, maxY: number, radius: number,
): boolean {
  minX -= radius; minY -= radius; maxX += radius; maxY += radius;
  const dx = to.x - from.x, dy = to.y - from.y;
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [[from.x, dx, minX, maxX], [from.y, dy, minY, maxY]]) {
    if (Math.abs(delta) <= COLLISION_RULES.epsilon) {
      if (start < min - COLLISION_RULES.epsilon || start > max + COLLISION_RULES.epsilon) return false;
      continue;
    }
    const t0 = (min - start) / delta;
    const t1 = (max - start) / delta;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi + COLLISION_RULES.epsilon) return false;
  }
  return true;
}

/** Exact centerline closest approach for moving ship versus stationary ship. */
function segmentHitsVessel(from: WorldPoint, to: WorldPoint, vessel: VesselBody, radius: number): boolean {
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const projected = lengthSquared === 0 ? 0 :
    ((vessel.x - from.x) * dx + (vessel.y - from.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, projected));
  const x = from.x + dx * t, y = from.y + dy * t;
  return Math.hypot(x - vessel.x, y - vessel.y) < radius + vessel.radius - COLLISION_RULES.epsilon;
}

/**
 * Validate the WHOLE ship movement segment, not just the destination.
 * Expanding rectangular obstacles by radius is deliberately conservative at corners.
 * Physical hull collision never depends on untrusted client coordinates.
 */
export function canSweepVessel(
  from: WorldPoint, to: WorldPoint, radius: number,
  env: CollisionEnvironment, excludeVesselId?: bigint,
): boolean {
  assertEnvironment(env, radius);
  if (!validPoint(from) || !validPoint(to)) return false;
  const size = env.mapCells;
  if ([from.x, to.x].some(x => x < radius || x > size - radius) ||
      [from.y, to.y].some(y => y < radius || y > size - radius)) return false;

  const startX = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
  const stopX = Math.min(size - 1, Math.floor(Math.max(from.x, to.x) + radius));
  const startY = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
  const stopY = Math.min(size - 1, Math.floor(Math.max(from.y, to.y) + radius));
  for (let y = startY; y <= stopY; y++) for (let x = startX; x <= stopX; x++) {
    if (env.terrain[y * size + x] !== TERRAIN.DEEP_WATER &&
        env.terrain[y * size + x] !== TERRAIN.SHALLOW_WATER) {
      if (segmentIntersectsExpandedRect(from, to, x, y, x + 1, y + 1, radius)) return false;
    }
  }
  for (const rect of env.footprints ?? []) {
    if (rect.x > stopX || rect.y > stopY || rect.x + rect.width < startX || rect.y + rect.height < startY) continue;
    if (segmentIntersectsExpandedRect(from, to, rect.x, rect.y,
      rect.x + rect.width, rect.y + rect.height, radius)) return false;
  }
  for (const vessel of env.vessels ?? []) {
    if (vessel.id === excludeVesselId) continue;
    if (segmentHitsVessel(from, to, vessel, radius)) return false;
  }
  return true;
}

/** Is this grid-cell center disallowed for a hull, including static/dynamic blockers? */
export function isNavigationCellBlocked(
  x: number, y: number, radius: number, env: CollisionEnvironment,
  excludeVesselId?: bigint,
): boolean {
  const point = { x: x + 0.5, y: y + 0.5 };
  return !canSweepVessel(point, point, radius, env, excludeVesselId);
}

/** Snapshot of all hull bodies in one match; update positions after each server tick move. */
export function createVesselBodies(
  ships: readonly Readonly<{ id: bigint; x: number; y: number }>[],
  radius = COLLISION_RULES.scoutRadiusCells,
): VesselBody[] {
  return ships.map(ship => ({ id: ship.id, x: ship.x, y: ship.y, radius }));
}
