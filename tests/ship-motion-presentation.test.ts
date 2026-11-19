import { describe, expect, it } from "vitest";
import {
  SnapshotBuffer, shouldRecordMotionSample, type MotionSnapshot,
} from "../src/game/motion/SnapshotBuffer";

describe("ship presentation: stopped position survives the next move", () => {
  const sample = (overrides: Partial<MotionSnapshot>): MotionSnapshot => ({
    timeMs: 1000, revision: 7, x: 12.25, y: 16.75,
    vx: 1, vy: 0, hullAngle: 0, turretAngle: 0, ...overrides,
  });

  it("records final server position when motion stops without a new order revision", () => {
    const moving = sample({});
    const arrived = sample({
      timeMs: 1100, x: 12.38, y: 16.75, vx: 0, vy: 0,
      revision: 7, // scheduled reducer does NOT increment order revision
    });

    expect(shouldRecordMotionSample(moving, arrived)).toBe(true);
    expect(shouldRecordMotionSample(arrived, { ...arrived, timeMs: 1200 }))
      .toBe(false); // unrelated subscription updates cannot duplicate the point

    const buffer = new SnapshotBuffer({ maxExtrapolationMs: 120 });
    expect(buffer.push(moving)).toBe(true);
    expect(buffer.push(arrived)).toBe(true);
    expect(buffer.sample(1200)).toMatchObject({
      x: 12.38, y: 16.75, vx: 0, vy: 0,
    });

    const freshOrder = sample({
      timeMs: 1300, revision: 8, x: 12.38, y: 16.75, vx: 0, vy: 0,
    });
    expect(shouldRecordMotionSample(arrived, freshOrder)).toBe(true);
    expect(buffer.push(freshOrder)).toBe(true);
    expect(buffer.sample(1300)).toMatchObject({
      x: 12.38, y: 16.75,
    });
  });

  it("records server movement at the same revision without inventing extra samples", () => {
    const previous = sample({ revision: 9 });
    const next = sample({ revision: 9, timeMs: 1100, x: 12.4, y: 16.8 });
    expect(shouldRecordMotionSample(previous, next)).toBe(true);
    expect(shouldRecordMotionSample(next, next)).toBe(false);
    expect(shouldRecordMotionSample(null, previous)).toBe(true);
  });
});
