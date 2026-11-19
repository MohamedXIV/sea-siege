/** Small, renderer-agnostic wake geometry: two tapering foam trails. */
export type WakeSegment = Readonly<{
  ax: number; ay: number; bx: number; by: number; alpha: number; width: number;
}>;

/**
 * Coordinates are local to a non-rotated Phaser ship container. Its hull
 * independently rotates; wakes are aligned with the real presented velocity
 * and never require a server effect/network row.
 */
export function shipWakeSegments(
  velocityX: number, velocityY: number,
  hullLengthPx: number, phase: number,
): WakeSegment[] {
  if (![velocityX, velocityY, hullLengthPx, phase].every(Number.isFinite) ||
      hullLengthPx <= 0) return [];
  const speed = Math.hypot(velocityX, velocityY);
  if (speed < 0.18) return [];
  const power = Math.max(0.2, Math.min(1, speed / 3));
  const forwardX = velocityX / speed, forwardY = velocityY / speed;
  const sideX = -forwardY, sideY = forwardX;
  const trail = 16 + 35 * power;
  const rear = hullLengthPx * 0.44;
  const spread = Math.max(4, hullLengthPx * 0.16);
  const segments: WakeSegment[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const point = (t: number) => {
        const backward = rear + trail * t;
        const width = spread + 13 * t + Math.sin(phase * 2 + t * 17 + side) * (1 + 2 * t);
        return {
          x: -forwardX * backward + sideX * side * width,
          y: -forwardY * backward + sideY * side * width,
        };
      };
      const a = point(i / 5), b = point((i + 1) / 5);
      segments.push({
        ax: a.x, ay: a.y, bx: b.x, by: b.y,
        alpha: (0.2 + 0.55 * power) * (1 - i / 6),
        width: i < 2 ? 2.4 : 1.25,
      });
    }
  }
  return segments;
}
