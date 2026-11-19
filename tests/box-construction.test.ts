import { describe, expect, it } from "vitest";
import { planBoxConstruction, MAX_BOX_CONSTRUCTION } from "../spacetimedb/src/sim/box-construction";
import type { BuildRequest, StructureShape } from "../spacetimedb/src/sim/construction";

const SIZE = 20;
const core: StructureShape = {
  id: 1n, ownerSlot: 0, kind: "command_core",
  gridX: 3, gridY: 3, width: 3, height: 3, complete: true,
};
function request(overrides: Partial<BuildRequest> = {}): BuildRequest {
  return {
    kind: "platform", ownerSlot: 0, gridX: 6, gridY: 4,
    salvage: 420, mapCells: SIZE,
    terrain: new Uint8Array(SIZE * SIZE),
    structures: [core], deposits: [], hulls: [],
    ...overrides,
  };
}

describe("Gemini box construction planner — all-or-nothing", () => {
  it("grows a connected platform rectangle outward from a single valid anchor", () => {
    const plan = planBoxConstruction(request(), 8, 5);
    expect(plan.reason).toBeNull();
    expect(plan.cells).toHaveLength(6);
    expect(plan.cells[0]).toEqual({ gridX: 6, gridY: 4 });
    expect(new Set(plan.cells.map(c => `${c.gridX},${c.gridY}`)).size).toBe(6);
  });

  it("rejects entire rectangle if both endpoints are valid but a middle tile is blocked", () => {
    const terrain = new Uint8Array(SIZE * SIZE);
    terrain[4 * SIZE + 7] = 2; // central ruined pillar
    const plan = planBoxConstruction(request({ terrain }), 8, 4);
    expect(plan.reason).toMatch(/Cell \(7, 4\): Impassable terrain/);
    expect(plan.cells).toHaveLength(0);
  });

  it("does not allow partial construction if total batch cost is unaffordable", () => {
    const plan = planBoxConstruction(request({ salvage: 50 }), 8, 4);
    expect(plan.reason).toMatch(/Insufficient salvage/);
    expect(plan.cells).toHaveLength(0);
  });

  it("rejects oversized rectangles instead of scheduling unbounded rows", () => {
    const plan = planBoxConstruction(request({ salvage: 10_000 }), 6 + MAX_BOX_CONSTRUCTION, 4);
    expect(plan.reason).toMatch(/limited/);
    expect(plan.cells).toHaveLength(0);
  });

  it("rejects rectangles whose 2x2 superstructure anchors cannot tile evenly", () => {
    const platforms: StructureShape[] = [];
    for (let y = 6; y <= 7; y++) for (let x = 3; x <= 6; x++)
      platforms.push({
        id: BigInt(10 + y * SIZE + x), ownerSlot: 0, kind: "platform",
        gridX: x, gridY: y, width: 1, height: 1, complete: true,
      });
    const req = request({
      kind: "workshop", gridX: 3, gridY: 6,
      structures: [core, ...platforms],
    });
    const result = planBoxConstruction(req, 4, 6);
    expect(result.reason).toMatch(/2×2/);
    expect(result.cells).toHaveLength(0);
    expect(planBoxConstruction(req, 5, 6).cells).toHaveLength(2);
  });
});
