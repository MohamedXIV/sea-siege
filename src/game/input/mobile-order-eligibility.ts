import type { SpacetimeClientState } from "@/network/spacetime-client";

/** Touch orders require a real owned ship and a live world-action context. */
export function canArmMobileOrder(
  selectedShipIds: readonly bigint[], state: SpacetimeClientState, building: boolean,
): boolean {
  if (building || !selectedShipIds.length || state.status !== "connected" ||
      state.subscriptionStatus !== "applied" || !state.myMembership ||
      state.activeMatch?.phase !== "active") return false;
  const ids = new Set(selectedShipIds);
  return state.myShips.some(ship => ids.has(ship.id));
}
