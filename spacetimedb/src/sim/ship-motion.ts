/**
 * Authoritative server-side vessel movement. Pure and deterministic: neither
 * SpacetimeDB clock nor browser render timing is read from inside this module.
 * All coordinates/speeds are in world grid cells and seconds.
 */
export const SHIP_MOTION_RULES = {
  tickMicroseconds: 100_000n, // desired 10 Hz; not a guaranteed scheduling cadence
  maxDeltaMicroseconds: 250_000n,
  speedCellsPerSecond: 2,
  turnDegreesPerSecond: 150,
  fullSpeedAngleDeg: 25,
  stopMovementAngleDeg: 90,
  arrivalEpsilonCells: 0.000_001,
} as const;

export type ShipKinematics = Readonly<{
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  hullAngleDeg: number;
}>;

export type TravelSegment = Readonly<{
  from: Readonly<{ x: number; y: number }>;
  to: Readonly<{ x: number; y: number }>;
}>;
export type RouteMotionResult = Readonly<{
  ship: ShipKinematics;
  cursor: number;
  arrived: boolean;
  changed: boolean;
  /** Exact ordered physical legs travelled this tick, not a start/end chord. */
  traversedSegments: readonly TravelSegment[];
}>;

/** Real elapsed time. Slow/late ticks never simulate arbitrarily large leaps. */
export function boundedDeltaSeconds(previousUs: bigint, nowUs: bigint): number {
  const elapsed = nowUs - previousUs;
  if (elapsed <= 0n) return 0;
  const clamped = elapsed > SHIP_MOTION_RULES.maxDeltaMicroseconds
    ? SHIP_MOTION_RULES.maxDeltaMicroseconds : elapsed;
  return Number(clamped) / 1_000_000;
}

function normalizeDegrees(angle: number): number {
  return ((angle % 360) + 360) % 360;
}
function shortestTurnDegrees(start: number, end: number): number {
  return ((end - start + 540) % 360) - 180;
}

/**
 * Follow a previously server-validated sequence of walkable cell centers.
 * A route always starts from the ship's actual current position, never by
 * teleporting it to the path's first waypoint. An arrival consumes the route.
 *
 * Dynamic buildings, physical hull radii, and inter-ship avoidance are
 * intentionally NOT solved by this primitive; integrate in #8/#10 before
 * calling it production collision-safe.
 */
export function advanceShipOnRoute(
  ship: ShipKinematics,
  cellPath: readonly number[],
  cursor: number,
  mapCells: number,
  seconds: number,
): RouteMotionResult {
  if (!Number.isInteger(mapCells) || mapCells < 2 ||
      !Number.isInteger(cursor) || cursor < 0 || cursor > cellPath.length ||
      !Number.isFinite(seconds) || seconds < 0 ||
      !Object.values(ship).every(Number.isFinite)) {
    throw new RangeError('invalid ship motion input');
  }
  if (seconds === 0) return {
    ship, cursor, arrived: cursor === cellPath.length, changed: false,
    traversedSegments: [],
  };

  let { x, y } = ship;
  let heading = normalizeDegrees(ship.hullAngleDeg);
  let remaining = Math.min(seconds, Number(SHIP_MOTION_RULES.maxDeltaMicroseconds) / 1_000_000);
  let nextCursor = cursor;
  let movedX = 0;
  let movedY = 0;
  let turned = false;
  const traversedSegments: TravelSegment[] = [];
  const epsilon = SHIP_MOTION_RULES.arrivalEpsilonCells;

  // The step may consume multiple short segments, never jump across a corner.
  // The hard limit protects against malformed large paths or zero-length loops.
  let traversed = 0;
  while (nextCursor < cellPath.length && remaining > 0 && traversed <= cellPath.length) {
    const cell = cellPath[nextCursor]!;
    if (!Number.isInteger(cell) || cell < 0 || cell >= mapCells * mapCells) {
      throw new RangeError('invalid route cell');
    }
    const destX = (cell % mapCells) + 0.5;
    const destY = Math.floor(cell / mapCells) + 0.5;
    const dx = destX - x;
    const dy = destY - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= epsilon) {
      x = destX;
      y = destY;
      nextCursor++;
      traversed++;
      continue;
    }

    const targetAngle = normalizeDegrees(Math.atan2(dy, dx) * 180 / Math.PI);
    const turn = shortestTurnDegrees(heading, targetAngle);
    const maxTurn = SHIP_MOTION_RULES.turnDegreesPerSecond * remaining;
    const appliedTurn = Math.max(-maxTurn, Math.min(maxTurn, turn));
    if (Math.abs(appliedTurn) > 1e-10) turned = true;
    heading = normalizeDegrees(heading + appliedTurn);
    const residual = Math.abs(shortestTurnDegrees(heading, targetAngle));
    // A large turn costs speed rather than allowing a ship to slide sideways.
    const ramp = (SHIP_MOTION_RULES.stopMovementAngleDeg - residual) /
      (SHIP_MOTION_RULES.stopMovementAngleDeg - SHIP_MOTION_RULES.fullSpeedAngleDeg);
    const speedFactor = Math.max(0, Math.min(1, ramp));
    const move = Math.min(distance, SHIP_MOTION_RULES.speedCellsPerSecond * remaining * speedFactor);
    if (move <= epsilon) break;
    const previous = { x, y };
    const moveX = (dx / distance) * move;
    const moveY = (dy / distance) * move;
    x += moveX;
    y += moveY;
    movedX += moveX;
    movedY += moveY;
    if (distance - move <= epsilon) {
      x = destX;
      y = destY;
      nextCursor++;
      traversed++;
      // Remaining time is only reused after full-speed travel; turn cost is
      // accounted for by the speed factor (conservative under curved turns).
      remaining -= move / (SHIP_MOTION_RULES.speedCellsPerSecond * speedFactor);
    } else {
      remaining = 0;
    }
    traversedSegments.push({ from: previous, to: { x, y } });
  }

  const arrived = nextCursor === cellPath.length;
  const velocityX = arrived ? 0 : movedX / seconds;
  const velocityY = arrived ? 0 : movedY / seconds;
  const result: ShipKinematics = { x, y, velocityX, velocityY, hullAngleDeg: heading };
  const changed = nextCursor !== cursor || turned ||
    Math.abs(x - ship.x) > epsilon || Math.abs(y - ship.y) > epsilon ||
    Math.abs(velocityX - ship.velocityX) > epsilon || Math.abs(velocityY - ship.velocityY) > epsilon;
  return {
    ship: changed ? result : ship, cursor: nextCursor, arrived, changed,
    traversedSegments,
  };
}
