/** Lobby slots and bot seeds are server-derived, deterministic and match-local. */
export function firstFreeSlot(maxSlots: number, occupied: readonly number[]): number | null {
  if (!Number.isInteger(maxSlots) || maxSlots < 2 || maxSlots > 8 ||
      occupied.some(slot => !Number.isInteger(slot) || slot < 0 || slot >= maxSlots))
    throw new RangeError('Invalid lobby seat state');
  const seen = new Set(occupied);
  if (seen.size !== occupied.length) throw new Error('Duplicate faction slot');
  for (let slot = 0; slot < maxSlots; slot++) if (!seen.has(slot)) return slot;
  return null;
}
/** Bot RNG never uses a client-chosen seed and doesn't expose the world seed. */
export function deriveBotSeed(worldSeed: number, slot: number): number {
  if (![worldSeed, slot].every(Number.isInteger) || worldSeed < 0 ||
      worldSeed > 0xffffffff || slot < 0 || slot > 7)
    throw new RangeError('Invalid bot seed inputs');
  let h = (worldSeed ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
