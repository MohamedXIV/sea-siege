/** All workshop balance parameters live here; these are initial tuning defaults. */
export const WORKSHOP_RULES = {
  tiers: {
    1: { radiusCells: 4.5, maxRepairHp: 60, hpPerSalvage: 2, extraMaxHp: 0 },
    2: { radiusCells: 6, maxRepairHp: 100, hpPerSalvage: 3, extraMaxHp: 120 },
    3: { radiusCells: 8, maxRepairHp: 150, hpPerSalvage: 4, extraMaxHp: 240 },
  },
  upgrades: {
    2: { cost: 200, durationUs: 6_000_000n },
    3: { cost: 320, durationUs: 10_000_000n },
  },
} as const;

export type WorkshopTier = 1 | 2 | 3;
export type WorkshopUpgrade = 2 | 3;
export type Point = Readonly<{ x: number; y: number }>;

export function workshopTier(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 3) throw new RangeError('Invalid workshop tier');
  return WORKSHOP_RULES.tiers[level as WorkshopTier];
}

export function nextWorkshopUpgrade(level: number) {
  workshopTier(level);
  return level === 3 ? null : WORKSHOP_RULES.upgrades[(level + 1) as WorkshopUpgrade];
}

export function maximumStructureHp(baseHp: number, level: number, kind: string): number {
  if (!Number.isSafeInteger(baseHp) || baseHp <= 0) throw new RangeError('Invalid base HP');
  return baseHp + (kind === 'workshop' ? workshopTier(level).extraMaxHp : 0);
}

export function withinWorkshopRange(workshop: Point, target: Point, level: number): boolean {
  const radius = workshopTier(level).radiusCells;
  return [workshop.x, workshop.y, target.x, target.y].every(Number.isFinite) &&
    Math.hypot(workshop.x - target.x, workshop.y - target.y) <= radius;
}

/** Charges only the HP actually recovered. No over-repair or free fractional costs. */
export function calculateRepair(
  currentHp: number, maxHp: number, requestedHp: number, tier: number,
): { restoredHp: number; salvageCost: number; newHp: number } {
  const rule = workshopTier(tier);
  if (![currentHp, maxHp, requestedHp].every(Number.isSafeInteger) ||
    maxHp <= 0 || currentHp <= 0 || currentHp > maxHp || requestedHp <= 0) {
    throw new RangeError('Invalid repair HP');
  }
  if (currentHp === maxHp) throw new Error('Target already at full health');
  const restoredHp = Math.min(maxHp - currentHp, requestedHp, rule.maxRepairHp);
  const salvageCost = Math.ceil(restoredHp / rule.hpPerSalvage);
  return { restoredHp, salvageCost, newHp: currentHp + restoredHp };
}

/** Upgrade progress is server-owned and pauses while workshop cannot operate. */
export function progressWorkshopUpgrade(
  remainingUs: bigint, elapsedUs: bigint, operational: boolean,
): bigint {
  if (remainingUs < 0n || elapsedUs < 0n) throw new RangeError('Invalid upgrade time');
  if (!operational) return remainingUs;
  return elapsedUs >= remainingUs ? 0n : remainingUs - elapsedUs;
}
