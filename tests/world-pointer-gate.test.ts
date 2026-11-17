import { describe, expect, it } from "vitest";
import { canHandleWorldPointer } from "../src/game/input/world-pointer-gate";

describe("Phaser world pointer ownership", () => {
  it("accepts a real canvas hit while the playable HUD is visible", () => {
    expect(canHandleWorldPointer(true, true, true)).toBe(true);
  });

  it("ignores canvas input when Menu or Results replaces the HUD", () => {
    expect(canHandleWorldPointer(false, true, true)).toBe(false);
  });

  it("ignores UI clicks even if the browser sent them from a canvas gesture", () => {
    expect(canHandleWorldPointer(true, true, false)).toBe(false);
    expect(canHandleWorldPointer(true, false, true)).toBe(false);
  });
});
