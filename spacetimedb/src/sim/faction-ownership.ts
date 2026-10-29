/**
 * Canonical faction identity is match-scoped, not a network Identity.
 * The key is persisted in both human membership and ship rows solely to
 * support indexed identity-filtered views without leaking same-slot ships
 * from another match.
 */
export function factionKey(matchId: bigint, slot: number): string {
  if (matchId < 0n || !Number.isInteger(slot) || slot < 0 || slot > 0xffffffff)
    throw new RangeError('Invalid match faction');
  return matchId.toString(10) + ':' + slot.toString(10);
}

/**
 * Only a verified HUMAN membership permits a client reducer to act.
 * Bot factions deliberately have no human membership; internal AI commands
 * will require a different server-owned validation capability.
 */
export function mayControlFaction(
  memberSlot: number | undefined, unitSlot: number, eliminated: boolean,
): boolean {
  return memberSlot !== undefined && Number.isInteger(memberSlot) &&
    Number.isInteger(unitSlot) && memberSlot >= 0 && unitSlot >= 0 &&
    memberSlot === unitSlot && !eliminated;
}
