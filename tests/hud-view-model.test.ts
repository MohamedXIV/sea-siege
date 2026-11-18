import { describe, expect, it } from "vitest";
import type { SpacetimeClientState } from "../src/network/spacetime-client";
import { getHudSummary } from "../src/components/hud/hud-view-model";

function stateWith(overrides: Partial<SpacetimeClientState>): SpacetimeClientState {
  return {
    status: "connected",
    subscriptionStatus: "applied",
    myMembership: { slot: 0 } as SpacetimeClientState["myMembership"],
    myFaction: { salvage: 0 } as SpacetimeClientState["myFaction"],
    materialBalances: [],
    myShips: [],
    myStructures: [],
    visibleEnemies: [],
    ...overrides,
  } as SpacetimeClientState;
}

describe("authorized HUD summary", () => {
  it("does not present stale values as current while reconnecting", () => {
    const summary = getHudSummary(stateWith({
      status: "reconnecting",
      myFaction: { salvage: 99 } as SpacetimeClientState["myFaction"],
      myShips: [{ id: 1n }] as SpacetimeClientState["myShips"],
    }));

    expect(summary.connected).toBe(false);
    expect(summary.fleetCount).toBeNull();
    expect(summary.materials).toEqual({ iron: null, oil: null, alloy: null, isotope: null });
  });

  it("maps owned fleet, structures, visible enemies and all four resources", () => {
    const summary = getHudSummary(stateWith({
      myFaction: { salvage: 420 } as SpacetimeClientState["myFaction"],
      myShips: [{ id: 1n }, { id: 2n }] as SpacetimeClientState["myShips"],
      myStructures: [{ id: 3n }] as SpacetimeClientState["myStructures"],
      visibleEnemies: [{ id: 4n }, { id: 5n }, { id: 6n }] as SpacetimeClientState["visibleEnemies"],
      materialBalances: [
        { kind: "alloy", amount: 8 },
        { kind: "isotope", amount: 2 },
        { kind: "oil", amount: 25 },
      ] as SpacetimeClientState["materialBalances"],
    }));

    expect(summary).toEqual({
      connected: true,
      fleetCount: 2,
      structureCount: 1,
      enemyAssetCount: 3,
      materials: { iron: 420, oil: 25, alloy: 8, isotope: 2 },
    });
  });

  it("shows missing resource rows as unavailable, rather than inventing zero", () => {
    const summary = getHudSummary(stateWith({
      myFaction: { salvage: 36 } as SpacetimeClientState["myFaction"],
      materialBalances: [{ kind: "oil", amount: 0 }] as SpacetimeClientState["materialBalances"],
    }));

    expect(summary.materials).toEqual({ iron: 36, oil: 0, alloy: null, isotope: null });
  });

  it("does not expose a wallet if no owned faction is available", () => {
    const summary = getHudSummary(stateWith({ myFaction: null }));
    expect(summary.materials).toEqual({ iron: null, oil: null, alloy: null, isotope: null });
  });

  it("keeps counts unavailable until the authorized subscription is applied", () => {
    const summary = getHudSummary(stateWith({ subscriptionStatus: "subscribing" }));
    expect(summary).toMatchObject({ connected: false, fleetCount: null, structureCount: null, enemyAssetCount: null });
  });

  it("does not call an empty subscription an owned zero fleet without match membership", () => {
    const summary = getHudSummary(stateWith({ myMembership: null }));
    expect(summary).toMatchObject({ connected: true, fleetCount: null, structureCount: null, enemyAssetCount: null });
    expect(summary.materials).toEqual({ iron: null, oil: null, alloy: null, isotope: null });
  });
});
