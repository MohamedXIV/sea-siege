import { describe, expect, it } from "vitest";
import { selectStructureAt } from "../src/game/input/structure-selection";

const deck = {
  id: 1n, kind: "platform", channel: "surface",
  gridX: 6, gridY: 8, width: 1, height: 1,
};
const yard = {
  id: 9n, kind: "shipyard", channel: "superstructure",
  gridX: 6, gridY: 8, width: 2, height: 2,
};

describe("Gemini building hit-test", () => {
  it("selects a mounted Shipyard rather than the underlying Platform", () => {
    expect(selectStructureAt(6.5, 8.5, [deck, yard])?.id).toBe(yard.id);
    expect(selectStructureAt(6.5, 8.5, [yard, deck])?.id).toBe(yard.id);
  });

  it("picks a platform when no superstructure covers the cell", () => {
    expect(selectStructureAt(6.5, 8.5, [deck])?.kind).toBe("platform");
    expect(selectStructureAt(5.5, 8.5, [deck, yard])).toBeNull();
  });

  it("can inspect a visible opponent building without opening its private orders", () => {
    const enemyRig = {
      ...yard, id: 40n, kind: "salvage_rig",
    };
    expect(selectStructureAt(7.5, 9.5, [deck, enemyRig])?.id).toBe(enemyRig.id);
  });

  it("rejects invalid pointer coordinates instead of selecting arbitrary structures", () => {
    expect(selectStructureAt(Number.NaN, 8, [deck, yard])).toBeNull();
    expect(selectStructureAt(7, Number.POSITIVE_INFINITY, [deck, yard])).toBeNull();
  });
});
