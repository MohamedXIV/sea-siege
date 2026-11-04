import {
  createSeededRng, TERRAIN, type GeneratedWorld,
} from "./worldgen.ts";
import type { AdvancedResourceKind } from "./materials.ts";

export type GeneratedMaterialNode = Readonly<{
  kind: AdvancedResourceKind;
  gridX: number;
  gridY: number;
  capacity: number;
  regenPerSec: number;
  contested: boolean;
}>;

/**
 * Deterministic, fair additions to Gemini's original seeded map.
 *
 * Every starting faction gets an accessible oil deposit *beyond* its two
 * ordinary near-base iron/salvage deposits. Scarcer alloys and isotopes are
 * contestable central prizes, rather than mandatory starting resources.
 * Does NOT change the existing terrain chunks, spawns or legacy deposits.
 */
export function generateMaterialNodes(world: GeneratedWorld): GeneratedMaterialNode[] {
  const cells = world.mapCells;
  const rng = createSeededRng((world.seed ^ 0x8a11_0c0a) >>> 0);
  const used = new Set(world.deposits.map(node => node.gridY * cells + node.gridX));
  const center = cells / 2;
  const result: GeneratedMaterialNode[] = [];
  const safe = (x: number, y: number) => {
    if (x < 2 || y < 2 || x >= cells - 2 || y >= cells - 2) return false;
    if (used.has(y * cells + x)) return false;
    const terrain = world.cells[y * cells + x];
    if (terrain !== TERRAIN.DEEP_WATER && terrain !== TERRAIN.SHALLOW_WATER) return false;
    return !world.spawns.some(spawn =>
      Math.hypot(x - spawn.gridX - 1.5, y - spawn.gridY - 1.5) < 7);
  };
  const add = (
    kind: AdvancedResourceKind, targetX: number, targetY: number,
    capacity: number, regenPerSec: number, contested: boolean,
  ) => {
    // Stable local search avoids overwriting original iron nodes or structures.
    for (let radius = 0; radius <= 8; radius++) {
      const choices: { x: number; y: number }[] = [];
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = Math.round(targetX) + dx, y = Math.round(targetY) + dy;
          if (safe(x, y)) choices.push({ x, y });
        }
      if (choices.length) {
        const candidate = choices[Math.floor(rng() * choices.length)]!;
        used.add(candidate.y * cells + candidate.x);
        result.push({
          kind, gridX: candidate.x, gridY: candidate.y,
          capacity, regenPerSec, contested,
        });
        return;
      }
    }
    throw new Error(`Cannot safely place ${kind} material deposit`);
  };

  for (const spawn of world.spawns) {
    const cx = spawn.gridX + 1.5, cy = spawn.gridY + 1.5;
    const towardCenter = Math.atan2(center - cy, center - cx);
    // Keep basic iron near the start, and oil a deliberate expansion away.
    const angle = towardCenter + (spawn.slotIndex % 2 ? -0.34 : 0.34);
    add("oil", cx + Math.cos(angle) * 12, cy + Math.sin(angle) * 12,
      650, 1, false);
  }

  const alloyCount = Math.max(2, Math.ceil(world.slotCount / 2));
  for (let i = 0; i < alloyCount; i++) {
    const angle = i * 2 * Math.PI / alloyCount + Math.PI / 5;
    add("alloy", center + Math.cos(angle) * cells * 0.15,
      center + Math.sin(angle) * cells * 0.15, 340, 0, true);
  }

  // The highest-tech deposit is conspicuous and scarce; never a requirement
  // for basic expansion, combat or victory.
  add("isotope", center + Math.cos(Math.PI / 3) * cells * 0.055,
    center + Math.sin(Math.PI / 3) * cells * 0.055, 160, 0, true);

  return result;
}
