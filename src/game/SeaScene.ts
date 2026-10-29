import Phaser from "phaser";

/** Purely visual foundation scene. World entities will come from authorized DB subscriptions (#5). */
export class SeaScene extends Phaser.Scene {
  private water!: Phaser.GameObjects.Graphics;
  private elapsed = 0;
  private redrawAccum = 0;
  private drag: { x: number; y: number; scrollX: number; scrollY: number } | null = null;

  constructor() {
    super({ key: "SeaScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#07121b");
    this.water = this.add.graphics();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.middleButtonDown() && !pointer.rightButtonDown()) return;
      this.drag = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.drag) return;
      const camera = this.cameras.main;
      camera.setScroll(
        this.drag.scrollX + (this.drag.x - pointer.x) / camera.zoom,
        this.drag.scrollY + (this.drag.y - pointer.y) / camera.zoom,
      );
    });
    this.input.on("pointerup", () => { this.drag = null; });
    this.input.on("wheel", (_p: unknown, _over: unknown, _dx: number, dy: number) => {
      const current = this.cameras.main.zoom;
      this.cameras.main.setZoom(Phaser.Math.Clamp(current * (dy > 0 ? 0.92 : 1.08), 0.55, 2.1));
    });
    this.redraw();
  }

  update(_time: number, delta: number): void {
    this.elapsed += delta;
    this.redrawAccum += delta;
    if (this.redrawAccum >= 60) {
      this.redrawAccum = 0;
      this.redraw();
    }
  }

  private redraw(): void {
    const gfx = this.water;
    if (!gfx) return;
    const { width, height } = this.scale;
    const camera = this.cameras.main;
    const zoom = camera.zoom;
    const minX = camera.scrollX;
    const minY = camera.scrollY;
    const spanX = width / zoom;
    const spanY = height / zoom;
    gfx.clear();
    gfx.fillStyle(0x08232e, 1);
    gfx.fillRect(minX - 8, minY - 8, spanX + 16, spanY + 16);

    const tile = 64;
    const startX = Math.floor(minX / tile) * tile;
    const startY = Math.floor(minY / tile) * tile;
    const endX = minX + spanX + tile;
    const endY = minY + spanY + tile;
    gfx.lineStyle(1 / zoom, 0x3d7382, 0.17);
    for (let x = startX; x < endX; x += tile) gfx.lineBetween(x, minY, x, endY);
    for (let y = startY; y < endY; y += tile) gfx.lineBetween(minX, y, endX, y);

    // Decorative, deterministic wave flecks: NOT simulated ships or authoritative world data.
    for (let gy = startY; gy < endY; gy += tile) {
      for (let gx = startX; gx < endX; gx += tile) {
        const wave = Math.sin(gx * 0.017 + gy * 0.033 + this.elapsed * 0.00045);
        if (wave < 0.1) continue;
        const offset = (wave + 1) * 12;
        gfx.lineStyle(2 / zoom, 0x69a9b5, 0.1 + wave * 0.1);
        gfx.lineBetween(gx + 8 + offset, gy + 22, gx + 18 + offset, gy + 22);
      }
    }
  }
}
