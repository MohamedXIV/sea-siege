import { describe, expect, it } from "vitest";
import { getHudSelectionLabel, type HudSelection } from "../src/components/hud/hud-selection";
import type { SpacetimeClientState } from "../src/network/spacetime-client";

function stateWith(overrides: Partial<SpacetimeClientState>): SpacetimeClientState {
  return {
    status: "connected",
    subscriptionStatus: "applied",
    myMembership: { slot: 0 },
    myShips: [],
    battleStructures: [],
    ...overrides,
  } as SpacetimeClientState;
}

describe("compact selection status", () => {
  it("shows no selection when nothing is selected", () => {
    expect(getHudSelectionLabel(null, stateWith({}))).toBe("No selection");
  });

  it("shows a selected owned ship with actual kind and HP", () => {
    const state = stateWith({ myShips: [{ id: 3n, kind: "scout", hp: 65 }] as SpacetimeClientState["myShips"] });
    expect(getHudSelectionLabel({ type: "ship", id: 3n }, state)).toBe("Scout selected · HP 65");
  });

  it("counts only currently owned selected ships", () => {
    const state = stateWith({ myShips: [
      { id: 3n, kind: "scout", hp: 65 }, { id: 4n, kind: "gunboat", hp: 140 },
    ] as SpacetimeClientState["myShips"] });
    const selection: HudSelection = { type: "ship", id: 3n, shipIds: [3n, 4n, 999n] };
    expect(getHudSelectionLabel(selection, state)).toBe("2 ships selected");
  });

  it("distinguishes an enemy structure without exposing private data", () => {
    const state = stateWith({ battleStructures: [
      { id: 22n, kind: "shipyard", ownerSlot: 1, hp: 100 },
    ] as SpacetimeClientState["battleStructures"] });
    expect(getHudSelectionLabel({ type: "structure", id: 22n }, state)).toBe("Enemy Shipyard selected · HP 100");
  });

  it("does not show stale entities after a server update removes them", () => {
    expect(getHudSelectionLabel({ type: "ship", id: 55n }, stateWith({}))).toBe("No selection");
  });

  it("does not present previously selected ships as live during reconnect", () => {
    const state = stateWith({
      status: "reconnecting",
      myShips: [{ id: 3n, kind: "scout", hp: 65 }] as SpacetimeClientState["myShips"],
    });
    expect(getHudSelectionLabel({ type: "ship", id: 3n }, state)).toBe("No selection");
  });
});
