/** Pure deterministic turret bearings; angles are degrees clockwise from +X. */
export const TURRET_RULES = {
  turnDegreesPerSecond: {
    scout: 180,
    gunboat: 125,
    siege: 75,
    cannon: 100,
  },
  fireToleranceDegrees: 3,
} as const;

export type TurretKind = keyof typeof TURRET_RULES.turnDegreesPerSecond;

export function normalizeBearing(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new RangeError('Bearing must be finite');
  return ((degrees % 360) + 360) % 360;
}

/** Signed shortest-arc difference. Exact 180-degree ties always turn negative. */
export function angularDifference(from: number, to: number): number {
  return ((normalizeBearing(to) - normalizeBearing(from) + 540) % 360) - 180;
}

export function desiredBearing(from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>): number {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite) ||
    (from.x === to.x && from.y === to.y)) {
    throw new RangeError('Invalid aiming positions');
  }
  return normalizeBearing(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI);
}

export function turretAligned(current: number, desired: number,
  tolerance: number = TURRET_RULES.fireToleranceDegrees): boolean {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 180)
    throw new RangeError('Invalid aiming tolerance');
  return Math.abs(angularDifference(current, desired)) <= tolerance;
}

/** No turret can snap more than the per-class angular limit in one server tick. */
export function advanceTurret(current: number, desired: number,
  kind: TurretKind, seconds: number): Readonly<{ angle: number; aligned: boolean }> {
  const rate = TURRET_RULES.turnDegreesPerSecond[kind];
  if (rate === undefined || !Number.isFinite(seconds) || seconds < 0 || seconds > 0.25) {
    throw new RangeError('Invalid turret step');
  }
  const delta = angularDifference(current, desired);
  const step = Math.min(Math.abs(delta), rate * seconds) * Math.sign(delta);
  const angle = normalizeBearing(current + step);
  return { angle, aligned: turretAligned(angle, desired) };
}
