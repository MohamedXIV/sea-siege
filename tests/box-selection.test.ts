import { describe, expect, it } from "vitest";
import { shipsInSelectionBox } from "../src/game/input/selection-box";

const ships = [
  { id: 3n, x: 20, y: 20, radius: 3 },
  { id: 1n, x: 30, y: 30, radius: 3 },
  { id: 2n, x: 80, y: 80, radius: 3 },
];

describe("RTS marquee selection", () => {
  it("selects multiple units by circle hit test regardless of drag direction", () => {
    const forward = shipsInSelectionBox({
      fromX: 10, fromY: 10, toX: 33, toY: 33,
    }, ships);
    const backward = shipsInSelectionBox({
      fromX: 33, fromY: 33, toX: 10, toY: 10,
    }, ships);
    expect(forward).toEqual([1n, 3n]);
    expect(backward).toEqual(forward);
  });

  it("empty drag clears selection instead of retaining a previously selected ship", () => {
    expect(shipsInSelectionBox({
      fromX: 45, fromY: 45, toX: 70, toY: 70,
    }, ships)).toEqual([]);
  });

  it("selects hulls that intersect the box edge but not nearby hulls outside", () => {
    expect(shipsInSelectionBox({
      fromX: 23, fromY: 18, toX: 24, toY: 21,
    }, ships)).toEqual([3n]);
    expect(shipsInSelectionBox({
      fromX: 24, fromY: 24, toX: 25, toY: 25,
    }, ships)).toEqual([]);
  });
});
