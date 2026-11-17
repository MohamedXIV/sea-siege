import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuildingInspector } from "../src/components/BuildingInspector";
import type { SpacetimeClientState } from "../src/network/spacetime-client";
import type { GeminiBattleStructure } from "../src/module_bindings/types";

describe("building inspection with private enemy tiers", () => {
  it("does not invent an enemy Workshop's maximum HP from an unknown tier", () => {
    const building = {
      id: 4n, kind: "workshop", ownerSlot: 1, hp: 920,
      complete: true, connected: true, gridX: 5, gridY: 5, width: 2, height: 2,
    } as GeminiBattleStructure;
    const state = {
      myMembership: { slot: 0 }, myStructures: [],
      salvageNodes: [], materialDeposits: [], productionJobs: [],
      myFaction: { salvage: 0 },
    } as SpacetimeClientState;
    const html = renderToStaticMarkup(createElement(BuildingInspector, {
      state, building, pending: false, perform: async () => {},
    }));
    expect(html).toContain("HP 920");
    expect(html).not.toMatch(/HP 920\s*\/\s*\d+/);
  });
});
