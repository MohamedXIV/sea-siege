import type { SpacetimeClientState } from "@/network/spacetime-client";

export type HudResource = "iron" | "oil" | "alloy" | "isotope";

export type HudSummary = Readonly<{
  connected: boolean;
  fleetCount: number | null;
  structureCount: number | null;
  enemyAssetCount: number | null;
  materials: Readonly<Record<HudResource, number | null>>;
}>;

/** Derived presentation only: no cached, simulated or client-owned match facts. */
export function getHudSummary(state: SpacetimeClientState): HudSummary {
  const connected = state.status === "connected" && state.subscriptionStatus === "applied";
  const owned = connected && state.myMembership != null;
  const faction = owned ? state.myFaction : null;
  const amountOf = (kind: Exclude<HudResource, "iron">): number | null =>
    faction ? state.materialBalances.find(balance => balance.kind === kind)?.amount ?? null : null;

  return {
    connected,
    fleetCount: owned ? state.myShips.length : null,
    structureCount: owned ? state.myStructures.length : null,
    enemyAssetCount: owned ? state.visibleEnemies.length : null,
    materials: {
      iron: faction?.salvage ?? null,
      oil: amountOf("oil"),
      alloy: amountOf("alloy"),
      isotope: amountOf("isotope"),
    },
  };
}
