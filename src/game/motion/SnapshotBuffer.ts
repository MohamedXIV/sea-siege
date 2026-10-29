/** Render-only ship samples. This class never modifies authoritative simulation state. */
export type MotionSnapshot = Readonly<{
  timeMs: number;
  revision: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hullAngle: number;
  turretAngle: number;
}>;

export type SampleKind = "hold" | "interpolated" | "extrapolated";
export type MotionPresentation = Readonly<Omit<MotionSnapshot, "timeMs" | "revision"> & {
  kind: SampleKind;
  sourceTimeMs: number;
}>;

export type SnapshotSettings = Readonly<{
  capacity?: number;
  maxExtrapolationMs?: number;
}>;

function finite(sample: MotionSnapshot): boolean {
  return Object.values(sample).every(value => Number.isFinite(value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate the shortest signed angle (radians), including wrap-around. */
export function interpolateAngle(a: number, b: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * alpha;
}

/** Ordered, bounded history of *already authorized* motion snapshots. */
export class SnapshotBuffer {
  private readonly snapshots: MotionSnapshot[] = [];
  private readonly capacity: number;
  private readonly maxExtrapolationMs: number;

  constructor(settings: SnapshotSettings = {}) {
    this.capacity = settings.capacity ?? 8;
    this.maxExtrapolationMs = settings.maxExtrapolationMs ?? 150;
    if (!Number.isInteger(this.capacity) || this.capacity < 2) throw new RangeError("capacity must be >= 2");
    if (!Number.isFinite(this.maxExtrapolationMs) || this.maxExtrapolationMs < 0) {
      throw new RangeError("maxExtrapolationMs must be nonnegative");
    }
  }

  get size(): number { return this.snapshots.length; }
  clear(): void { this.snapshots.length = 0; }

  /** Only monotonic server time is accepted; a newer revision may replace a same-time sample. */
  push(sample: MotionSnapshot): boolean {
    if (!finite(sample)) return false;
    const previous = this.snapshots.at(-1);
    if (previous) {
      if (sample.timeMs < previous.timeMs || sample.revision < previous.revision) return false;
      if (sample.timeMs === previous.timeMs) {
        if (sample.revision <= previous.revision) return false;
        this.snapshots[this.snapshots.length - 1] = { ...sample };
        return true;
      }
    }
    this.snapshots.push({ ...sample });
    if (this.snapshots.length > this.capacity) this.snapshots.shift();
    return true;
  }

  /** targetTimeMs is the mapped server clock minus a deliberate interpolation delay. */
  sample(targetTimeMs: number): MotionPresentation | null {
    if (!Number.isFinite(targetTimeMs) || this.snapshots.length === 0) return null;
    const history = this.snapshots;
    const first = history[0]!;
    const last = history[history.length - 1]!;
    if (targetTimeMs <= first.timeMs) return this.asPresentation(first, "hold");
    for (let i = 1; i < history.length; i++) {
      const next = history[i]!;
      if (targetTimeMs <= next.timeMs) {
        const prior = history[i - 1]!;
        const a = (targetTimeMs - prior.timeMs) / (next.timeMs - prior.timeMs);
        return {
          x: lerp(prior.x, next.x, a),
          y: lerp(prior.y, next.y, a),
          vx: lerp(prior.vx, next.vx, a),
          vy: lerp(prior.vy, next.vy, a),
          hullAngle: interpolateAngle(prior.hullAngle, next.hullAngle, a),
          turretAngle: interpolateAngle(prior.turretAngle, next.turretAngle, a),
          kind: "interpolated",
          sourceTimeMs: next.timeMs,
        };
      }
    }
    const extraMs = Math.min(targetTimeMs - last.timeMs, this.maxExtrapolationMs);
    if (extraMs <= 0) return this.asPresentation(last, "hold");
    return {
      x: last.x + last.vx * (extraMs / 1000),
      y: last.y + last.vy * (extraMs / 1000),
      vx: last.vx,
      vy: last.vy,
      hullAngle: last.hullAngle,
      turretAngle: last.turretAngle,
      kind: "extrapolated",
      sourceTimeMs: last.timeMs,
    };
  }

  private asPresentation(sample: MotionSnapshot, kind: SampleKind): MotionPresentation {
    return {
      x: sample.x, y: sample.y, vx: sample.vx, vy: sample.vy,
      hullAngle: sample.hullAngle, turretAngle: sample.turretAngle,
      kind, sourceTimeMs: sample.timeMs,
    };
  }
}
