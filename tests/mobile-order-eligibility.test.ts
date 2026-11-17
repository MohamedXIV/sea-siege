import { describe, expect, it } from "vitest";
import type { SpacetimeClientState } from "../src/network/spacetime-client";
import { canArmMobileOrder } from "../src/game/input/mobile-order-eligibility";

function stateWith(overrides: Partial<SpacetimeClientState> = {}): SpacetimeClientState {
  return {
    status: "connected",
    subscriptionStatus: "applied",
    myMembership: { slot: 0 },
    activeMatch: { phase: "active" },
    myShips: [{ id: 7n, kind: "scout" }],
    ...overrides,
  } as SpacetimeClientState;
}

describe("mobile order arming", () => {
  it("permits a selected owned ship in an active connected match", () => {
    expect(canArmMobileOrder([7n], stateWith(), false)).toBe(true);
  });

  it("refuses empty, missing, or enemy-only selections", () => {
    expect(canArmMobileOrder([], stateWith(), false)).toBe(false);
    expect(canArmMobileOrder([999n], stateWith(), false)).toBe(false);
  });

  it("refuses orders while construction owns world taps", () => {
    expect(canArmMobileOrder([7n], stateWith(), true)).toBe(false);
  });

  it("refuses stale orders after reconnect, missing membership, or match end", () => {
    expect(canArmMobileOrder([7n], stateWith({ status: "reconnecting" }), false)).toBe(false);
    expect(canArmMobileOrder([7n], stateWith({ myMembership: null }), false)).toBe(false);
    expect(canArmMobileOrder([7n], stateWith({ activeMatch: { phase: "finished" } as SpacetimeClientState["activeMatch"] }), false)).toBe(false);
  });
});
