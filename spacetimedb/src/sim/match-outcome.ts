/** Original Gemini time-limit scoring, expressed exactly in integer fifths. */
export const MATCH_RULES = {
  durationMs: 12 * 60 * 1000,
  coreHpWeight5: 5n,
  structureWeight5: 400n,
  shipWeight5: 500n,
  gatheredSalvageWeight5: 1n,
} as const;

export type FactionDominance = Readonly<{
  slot: number;
  coreHp: number;
  structures: number;
  ships: number;
  totalSalvageGathered: bigint;
}>;
export type MatchResult = Readonly<{
  winnerSlot: number;
  reason: 'domination' | 'mutual_destruction' | 'time_limit';
  winningScore5: bigint | null;
}>;

/** Exact accounting avoids floating point tie divergences between clients. */
export function dominanceScore5(row: FactionDominance): bigint {
  if (![row.slot, row.coreHp, row.structures, row.ships].every(Number.isSafeInteger) ||
      row.slot < 0 || row.coreHp < 0 || row.structures < 0 || row.ships < 0 ||
      row.totalSalvageGathered < 0n) throw new RangeError('Invalid faction score input');
  return BigInt(row.coreHp) * MATCH_RULES.coreHpWeight5 +
    BigInt(row.structures) * MATCH_RULES.structureWeight5 +
    BigInt(row.ships) * MATCH_RULES.shipWeight5 +
    row.totalSalvageGathered * MATCH_RULES.gatheredSalvageWeight5;
}

/** A single surviving Core wins immediately; otherwise score at the deadline. */
export function resolveMatchOutcome(
  living: readonly FactionDominance[], deadlineReached: boolean,
): MatchResult | null {
  const unique = new Set<number>();
  for (const faction of living) {
    dominanceScore5(faction);
    if (unique.has(faction.slot)) throw new RangeError('Duplicate faction slot');
    unique.add(faction.slot);
  }
  if (living.length === 0) return { winnerSlot: -1, reason: 'mutual_destruction', winningScore5: null };
  if (living.length === 1) return { winnerSlot: living[0]!.slot, reason: 'domination', winningScore5: null };
  if (!deadlineReached) return null;
  const ranked = living.map(faction => ({ slot: faction.slot, score: dominanceScore5(faction) }));
  ranked.sort((a, b) => a.score === b.score ? a.slot - b.slot : a.score > b.score ? -1 : 1);
  // Reference uses the first surviving faction on a true tie. Sorting by slot
  // preserves that rule without relying on DB iteration order.
  return { winnerSlot: ranked[0]!.slot, reason: 'time_limit', winningScore5: ranked[0]!.score };
}

export function deadlineMicroseconds(startUs: bigint): bigint {
  if (startUs < 0n) throw new RangeError('Invalid match start time');
  return startUs + BigInt(MATCH_RULES.durationMs) * 1000n;
}
