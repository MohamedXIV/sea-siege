/**
 * Pixel-art structures on the surface and mounted layers overlap in XY.
 * Hit testing must prioritize mounted factories/cannons/rigs, regardless of
 * SpacetimeDB iteration order or which structure was inserted first.
 */
export type ClickableStructure = Readonly<{
  id: bigint;
  kind: string;
  channel: string;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
}>;

export function selectStructureAt(
  x: number, y: number, structures: readonly ClickableStructure[],
): ClickableStructure | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let chosen: ClickableStructure | null = null;
  for (const candidate of structures) {
    if (x < candidate.gridX || x >= candidate.gridX + candidate.width ||
        y < candidate.gridY || y >= candidate.gridY + candidate.height) continue;
    if (!chosen || (candidate.channel === "superstructure" && chosen.channel !== "superstructure") ||
        (candidate.channel === chosen.channel && candidate.id > chosen.id)) {
      chosen = candidate;
    }
  }
  return chosen;
}
