import { describe, expect, it } from "vitest";
import { generateDeterministicWorld } from "../spacetimedb/src/sim/worldgen";
import { generateMaterialNodes } from "../spacetimedb/src/sim/material-world";
import {
  allocateResourceDraws, canAffordResources, creditResource,
  debitResources, emptyWallet, RESOURCE_RECIPES,
} from "../spacetimedb/src/sim/materials";

describe("material economy rules", () => {
  it("keeps basic Iron builds available but advanced recipes need distinct resources", () => {
    const start = emptyWallet(420);
    expect(canAffordResources(start, RESOURCE_RECIPES.platform)).toBe(true);
    expect(canAffordResources(start, RESOURCE_RECIPES.reinforced_hull)).toBe(false);
    const supplied = creditResource(start, "alloy", 40);
    const paid = debitResources(supplied, RESOURCE_RECIPES.reinforced_hull);
    expect(paid.iron).toBe(360);
    expect(paid.alloy).toBe(5);
    expect(supplied.iron).toBe(420);
    expect(supplied.alloy).toBe(40);
    expect(() => debitResources(start, RESOURCE_RECIPES.radiothermal_power))
      .toThrow("Insufficient resources");
  });

  it("shares one finite budget among several nodes and never overdraws", () => {
    const drawn = allocateResourceDraws([
      { id: 2n, kind: "alloy", remaining: 2 },
      { id: 1n, kind: "oil", remaining: 100 },
      { id: 3n, kind: "isotope", remaining: 9 },
    ], 8, 4);
    expect(drawn).toEqual([
      { id: 1n, kind: "oil", taken: 4 },
      { id: 2n, kind: "alloy", taken: 2 },
      { id: 3n, kind: "isotope", taken: 2 },
    ]);
    expect(drawn.reduce((sum, row) => sum + row.taken, 0)).toBe(8);
    expect(allocateResourceDraws([], 10)).toEqual([]);
    expect(() => allocateResourceDraws([], -1)).toThrow();
  });

  it.each([2, 4, 6, 8])(
    "generates reproducible no-overlap resources for %i factions", slots => {
      const world = generateDeterministicWorld(0x451abb7e, slots);
      const nodes = generateMaterialNodes(world);
      expect(nodes).toEqual(generateMaterialNodes(world));
      expect(nodes.filter(node => node.kind === "oil")).toHaveLength(slots);
      expect(nodes.filter(node => node.kind === "alloy")).toHaveLength(Math.max(2, Math.ceil(slots / 2)));
      expect(nodes.filter(node => node.kind === "isotope")).toHaveLength(1);
      const coords = new Set(world.deposits.map(n => `${n.gridX},${n.gridY}`));
      for (const node of nodes) {
        const key = `${node.gridX},${node.gridY}`;
        expect(coords.has(key)).toBe(false);
        coords.add(key);
        expect(node.gridX).toBeGreaterThan(1);
        expect(node.gridY).toBeGreaterThan(1);
        expect(node.gridX).toBeLessThan(world.mapCells - 2);
        expect(node.gridY).toBeLessThan(world.mapCells - 2);
      }
      expect(coords.size).toBe(world.deposits.length + nodes.length);
    }
  );
});
