import { describe, expect, it } from "vitest";
import {
  NO_SHIP_REFITS, purchaseShipRefit, refitMaximumShipHp,
  shipSpeedMultiplier,
} from "../spacetimedb/src/sim/ship-refits";
import { emptyWallet } from "../spacetimedb/src/sim/materials";
import { advanceShipOnRoute } from "../spacetimedb/src/sim/ship-motion";

describe("real advanced ship refits", () => {
  it("charges Iron and Oil atomically for engine and increases real motion speed", () => {
    const wallet = { ...emptyWallet(300), oil: 50 };
    const upgraded = purchaseShipRefit(wallet, NO_SHIP_REFITS, "high_output_engine");
    expect(upgraded.wallet.iron).toBe(225);
    expect(upgraded.wallet.oil).toBe(5);
    expect(wallet.oil).toBe(50);
    expect(upgraded.state.highOutputEngine).toBe(true);
    expect(shipSpeedMultiplier(upgraded.state)).toBe(1.2);
    expect(() => purchaseShipRefit(upgraded.wallet, upgraded.state, "high_output_engine"))
      .toThrow("already has");
    const start = {
      x: 4.5, y: 4.5, velocityX: 0, velocityY: 0,
      hullAngleDeg: 0,
    };
    const path = [4 * 16 + 7]; // eastbound waypoints
    const basic = advanceShipOnRoute(start, path, 0, 16, 0.2);
    const fast = advanceShipOnRoute(start, path, 0, 16, 0.2, shipSpeedMultiplier(upgraded.state));
    expect(fast.ship.x).toBeGreaterThan(basic.ship.x);
    expect(fast.ship.y).toBe(basic.ship.y);
    expect(fast.arrived).toBe(false);
  });

  it("reinforced hull adds repairable HP but requires both Iron and Alloys", () => {
    const wallet = { ...emptyWallet(200), alloy: 40 };
    const upgraded = purchaseShipRefit(wallet, NO_SHIP_REFITS, "reinforced_hull");
    expect(upgraded.wallet.iron).toBe(140);
    expect(upgraded.wallet.alloy).toBe(5);
    expect(refitMaximumShipHp(210, upgraded.state)).toBe(330);
    expect(refitMaximumShipHp(210, NO_SHIP_REFITS)).toBe(210);
    expect(shipSpeedMultiplier(upgraded.state)).toBe(1);
    expect(() => purchaseShipRefit(emptyWallet(200), NO_SHIP_REFITS, "reinforced_hull"))
      .toThrow("Insufficient refit resources");
  });
});
