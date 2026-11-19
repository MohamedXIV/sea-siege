import Phaser from "phaser";

/**
 * Direct TypeScript adaptation of Gemini's frozen PixelAssetGenerator.
 * Artwork is authored as 40px top-down pixel primitives, converted to Phaser
 * textures; Phaser remains the ONLY scene/renderer, never the old Canvas game.
 */
export const GEMINI_TILE_SIZE = 40;
export const GEMINI_PALETTES = [
  { name: "Vanguard Ironworks", primary: "#38bdf8", secondary: "#0284c7", accent: "#bae6fd" },
  { name: "Rustbelt Syndicate", primary: "#f97316", secondary: "#c2410c", accent: "#fed7aa" },
  { name: "Abyssal Dredgers", primary: "#eab308", secondary: "#a16207", accent: "#fef08a" },
  { name: "Tidebreaker Collective", primary: "#22c55e", secondary: "#15803d", accent: "#bbf7d0" },
  { name: "Siren Foundry", primary: "#ec4899", secondary: "#be185d", accent: "#fbcfe8" },
  { name: "Kraken Heavy Naval", primary: "#a855f7", secondary: "#7e22ce", accent: "#e9d5ff" },
  { name: "Saltspire Armada", primary: "#14b8a6", secondary: "#0f766e", accent: "#99f6e4" },
  { name: "Cinder Fleet", primary: "#ef4444", secondary: "#b91c1c", accent: "#fecaca" },
] as const;

export function geminiFactionColor(slot: number): string {
  return GEMINI_PALETTES[slot % GEMINI_PALETTES.length]!.primary;
}

export function geminiStructureTexture(
  scene: Phaser.Scene,
  kind: string,
  slot: number,
  connected: boolean,
  complete: boolean,
): string {
  const key = `gemini:${kind}:${slot}:${connected}:${complete}`;
  if (scene.textures.exists(key)) return key;

  const dims: Record<string, number> = {
    command_core: 120, platform: 40, workshop: 80,
    shipyard: 80, cannon: 40, salvage_rig: 80,
  };
  const w = dims[kind] ?? 40;
  const h = w;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable for Gemini texture generation");
  ctx.imageSmoothingEnabled = false;
  const accent = connected ? geminiFactionColor(slot) : "#64748b";
  const fill = (color: string, x: number, y: number, rw: number, rh: number) => {
    ctx.fillStyle = color; ctx.fillRect(x, y, rw, rh);
  };

  if (kind === "platform") {
    fill("#0f172a", 1, 1, w - 2, h - 2);
    fill("#1e293b", 2, h - 5, w - 4, 4);
    fill("#334155", 2, 2, w - 4, h - 6);
    for (let y = 6; y < h - 8; y += 6)
      for (let x = 6; x < w - 6; x += 6) fill("#1e293b", x, y, 3, 3);
    for (const [x, y] of [[4, 4], [w - 6, 4], [4, h - 8], [w - 6, h - 8]])
      fill("#94a3b8", x!, y!, 2, 2);
    fill(accent, w / 2 - 4, 3, 8, 2);
  } else if (kind === "command_core") {
    fill("#090d16", 2, 2, w - 4, h - 4);
    fill("#1e293b", 6, h - 14, w - 12, 10);
    fill("#334155", 6, 6, w - 12, h - 18);
    for (let i = 10; i < w - 14; i += 12) {
      fill("#eab308", i, 8, 6, 3);
      fill("#eab308", i, h - 16, 6, 3);
    }
    fill("#475569", 18, 16, w - 36, h - 38);
    fill("#1e293b", 18, h - 24, w - 36, 6);
    fill(accent, w / 2 - 16, h / 2 - 18, 32, 28);
    fill("#e0f2fe", w / 2 - 8, h / 2 - 10, 16, 12);
  } else if (kind === "shipyard") {
    fill("#1e293b", 4, 4, w - 8, h - 8);
    fill("#082f49", 14, 14, w - 28, h - 22);
    fill("#475569", 6, 6, 10, h - 14);
    fill("#475569", w - 16, 6, 10, h - 14);
    fill("#d97706", 6, 22, w - 12, 10);
    fill(accent, 10, 8, w - 20, 5);
  } else if (kind === "workshop") {
    fill("#1e293b", 6, h - 12, w - 12, 8);
    fill("#334155", 6, 6, w - 12, h - 16);
    fill("#475569", 10, 12, w - 20, 14);
    fill("#475569", 10, 32, w - 20, 14);
    fill("#f97316", w - 28, h - 30, 14, 14);
    fill(accent, 12, 14, 16, 6);
  } else if (kind === "salvage_rig") {
    fill("#1e293b", 6, h - 12, w - 12, 8);
    fill("#334155", 6, 6, w - 12, h - 16);
    fill("#0f172a", 16, 16, 24, 24);
    fill("#ca8a04", 20, 20, 16, 16);
    fill(accent, w - 28, 14, 16, 16);
    fill(accent, w - 28, 36, 16, 16);
  } else if (kind === "cannon") {
    fill("#1e293b", 4, 4, w - 8, h - 8);
    fill("#475569", 7, 7, w - 14, h - 14);
    fill(accent, 12, 12, w - 24, h - 24);
  } else {
    fill("#1e293b", 2, 2, w - 4, h - 4);
    fill(accent, 7, 7, w - 14, h - 14);
  }

  if (!complete) {
    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);
  }
  scene.textures.addCanvas(key, canvas);
  return key;
}
