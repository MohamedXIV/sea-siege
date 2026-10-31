import Phaser from "phaser";
import { spacetimeClient } from "../network/spacetime-client";
import { SnapshotBuffer } from "./motion/SnapshotBuffer";
import type { Ship, Structure, DetectedEnemyContact } from "../module_bindings/types";

const TILE_SIZE = 64;
const INTERPOLATION_DELAY_MS = 100;

interface ShipRenderData {
  id: bigint;
  buffer: SnapshotBuffer;
  container: Phaser.GameObjects.Container;
  hullGfx: Phaser.GameObjects.Graphics;
  turretGfx: Phaser.GameObjects.Graphics;
  selectionGfx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  lastRevision: number;
}

export class SeaScene extends Phaser.Scene {
  private waterGfx!: Phaser.GameObjects.Graphics;
  private structuresGfx!: Phaser.GameObjects.Graphics;
  private enemiesGfx!: Phaser.GameObjects.Graphics;
  private waypointsGfx!: Phaser.GameObjects.Graphics;

  private shipRenders = new Map<bigint, ShipRenderData>();
  private selectedShipId: bigint | null = null;
  private waypoint: { x: number; y: number; alpha: number } | null = null;

  private elapsed = 0;
  private redrawAccum = 0;
  private drag: { x: number; y: number; scrollX: number; scrollY: number; moved: boolean } | null = null;
  private unsubscribeClient: (() => void) | null = null;
  private initialCenterDone = false;

  constructor() {
    super({ key: "SeaScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#07121b");

    this.waterGfx = this.add.graphics().setDepth(0);
    this.structuresGfx = this.add.graphics().setDepth(10);
    this.enemiesGfx = this.add.graphics().setDepth(15);
    this.waypointsGfx = this.add.graphics().setDepth(20);

    // Input handlers for pan & zoom
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.middleButtonDown() || pointer.rightButtonDown()) {
        this.drag = {
          x: pointer.x,
          y: pointer.y,
          scrollX: this.cameras.main.scrollX,
          scrollY: this.cameras.main.scrollY,
          moved: false,
        };
      }
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.drag) return;
      const dx = Math.abs(pointer.x - this.drag.x);
      const dy = Math.abs(pointer.y - this.drag.y);
      if (dx > 3 || dy > 3) this.drag.moved = true;

      const camera = this.cameras.main;
      camera.setScroll(
        this.drag.scrollX + (this.drag.x - pointer.x) / camera.zoom,
        this.drag.scrollY + (this.drag.y - pointer.y) / camera.zoom
      );
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const wasDrag = this.drag && this.drag.moved;
      this.drag = null;

      if (!wasDrag) {
        this.handlePointerClick(pointer);
      }
    });

    this.input.on("wheel", (_p: unknown, _over: unknown, _dx: number, dy: number) => {
      const current = this.cameras.main.zoom;
      this.cameras.main.setZoom(
        Phaser.Math.Clamp(current * (dy > 0 ? 0.92 : 1.08), 0.35, 2.5)
      );
    });

    // Lifecycle cleanup
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    // Subscribe to spacetime updates
    this.unsubscribeClient = spacetimeClient.subscribeEntities(() => {
      this.syncFromBackend();
    });

    // Initial backend sync
    this.syncFromBackend();
    this.redrawWater();
  }

  private cleanup(): void {
    if (this.unsubscribeClient) {
      this.unsubscribeClient();
      this.unsubscribeClient = null;
    }
    for (const r of this.shipRenders.values()) {
      r.buffer.clear();
      try {
        r.container.destroy();
      } catch {
        // ignore
      }
    }
    this.shipRenders.clear();
  }

  private handlePointerClick(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const clickCellX = worldPoint.x / TILE_SIZE;
    const clickCellY = worldPoint.y / TILE_SIZE;

    const state = spacetimeClient.getState();

    // Check if clicked an owned ship
    if (pointer.leftButtonReleased()) {
      let clickedShip: Ship | null = null;
      for (const ship of state.myShips) {
        const render = this.shipRenders.get(ship.id);
        const posX = render ? render.container.x / TILE_SIZE : ship.x;
        const posY = render ? render.container.y / TILE_SIZE : ship.y;
        const dist = Phaser.Math.Distance.Between(clickCellX, clickCellY, posX, posY);
        if (dist <= ship.radiusCells + 0.5) {
          clickedShip = ship;
          break;
        }
      }

      if (clickedShip) {
        this.selectedShipId = clickedShip.id;
        this.updateSelectionRings();
        return;
      }
    }

    // If a ship was selected and clicked in water, issue server-side move order
    if (this.selectedShipId !== null && (pointer.leftButtonReleased() || pointer.rightButtonReleased())) {
      if (state.activeMatch?.phase !== "active") {
        console.warn("Movement orders only permitted in active matches");
        return;
      }

      const shipId = this.selectedShipId;
      const targetX = Math.round(clickCellX * 10) / 10;
      const targetY = Math.round(clickCellY * 10) / 10;

      // Show temporary waypoint visual
      this.waypoint = { x: targetX * TILE_SIZE, y: targetY * TILE_SIZE, alpha: 1.0 };

      spacetimeClient.issueShipOrder(shipId, targetX, targetY).catch((err) => {
        console.warn("Ship order rejected by server:", err?.message || err);
      });
    }
  }

  getSelectedShipId(): bigint | null {
    return this.selectedShipId;
  }

  setSelectedShipId(id: bigint | null): void {
    this.selectedShipId = id;
    this.updateSelectionRings();
  }

  private syncFromBackend(): void {
    if (!this.add || !this.sys) return;
    const state = spacetimeClient.getState();
    const ships = state.myShips;
    const activeShipIds = new Set(ships.map((s) => s.id));

    // Despawned ships
    for (const [id, data] of this.shipRenders.entries()) {
      if (!activeShipIds.has(id)) {
        data.container.destroy();
        data.buffer.clear();
        this.shipRenders.delete(id);
        if (this.selectedShipId === id) {
          this.selectedShipId = null;
        }
      }
    }

    const now = Date.now();

    // Update or create ships
    for (const ship of ships) {
      let render = this.shipRenders.get(ship.id);
      if (!render) {
        const container = this.add.container(ship.x * TILE_SIZE, ship.y * TILE_SIZE);
        container.setDepth(25);

        const selectionGfx = this.add.graphics();
        const hullGfx = this.add.graphics();
        const turretGfx = this.add.graphics();
        const label = this.add.text(0, -28, `${ship.kind} [S${ship.ownerSlot}]`, {
          fontSize: "11px",
          color: "#93c5fd",
          stroke: "#020617",
          strokeThickness: 3,
        }).setOrigin(0.5);

        container.add([selectionGfx, hullGfx, turretGfx, label]);

        const buffer = new SnapshotBuffer({ capacity: 16, maxExtrapolationMs: 250 });
        render = {
          id: ship.id,
          buffer,
          container,
          hullGfx,
          turretGfx,
          selectionGfx,
          label,
          lastRevision: -1,
        };
        this.shipRenders.set(ship.id, render);
        this.drawShipVisual(render, ship);
      }

      // Feed snapshot to SnapshotBuffer
      const revision = Number(ship.revision);
      if (revision !== render.lastRevision || ship.velocityX !== 0 || ship.velocityY !== 0) {
        render.lastRevision = revision;
        render.buffer.push({
          timeMs: now,
          revision,
          x: ship.x,
          y: ship.y,
          vx: ship.velocityX,
          vy: ship.velocityY,
          hullAngle: (ship.hullAngleDeg * Math.PI) / 180,
          turretAngle: (ship.turretAngleDeg * Math.PI) / 180,
        });
      }
    }

    this.updateSelectionRings();

    // Center camera on own base once on initial spawn
    if (!this.initialCenterDone && state.myStructures.length > 0) {
      const core = state.myStructures.find((s) => s.kind === "command_core");
      if (core) {
        const cx = (core.gridX + core.width / 2) * TILE_SIZE;
        const cy = (core.gridY + core.height / 2) * TILE_SIZE;
        this.cameras.main.centerOn(cx, cy);
        this.initialCenterDone = true;
      }
    }
  }

  private drawShipVisual(render: ShipRenderData, ship: Ship): void {
    const r = (ship.radiusCells * TILE_SIZE) || 24;

    // Hull polygon (sleek wedge/ship shape)
    const hull = render.hullGfx;
    hull.clear();
    hull.fillStyle(0x0e7490, 0.95);
    hull.lineStyle(2, 0x22d3ee, 1);
    hull.beginPath();
    hull.moveTo(r * 1.1, 0);
    hull.lineTo(-r * 0.8, -r * 0.7);
    hull.lineTo(-r * 0.5, 0);
    hull.lineTo(-r * 0.8, r * 0.7);
    hull.closePath();
    hull.fillPath();
    hull.strokePath();

    // Turret gun barrel
    const turret = render.turretGfx;
    turret.clear();
    turret.fillStyle(0x164e63, 1);
    turret.lineStyle(1.5, 0x67e8f9, 1);
    turret.fillCircle(0, 0, r * 0.35);
    turret.strokeCircle(0, 0, r * 0.35);
    turret.beginPath();
    turret.moveTo(0, 0);
    turret.lineTo(r * 0.85, 0);
    turret.strokePath();
  }

  private updateSelectionRings(): void {
    for (const [id, render] of this.shipRenders.entries()) {
      const gfx = render.selectionGfx;
      gfx.clear();
      if (id === this.selectedShipId) {
        gfx.lineStyle(2, 0x38bdf8, 0.9);
        gfx.strokeCircle(0, 0, 32);
        gfx.fillStyle(0x38bdf8, 0.15);
        gfx.fillCircle(0, 0, 32);
      }
    }
  }

  update(_time: number, delta: number): void {
    this.elapsed += delta;
    this.redrawAccum += delta;

    // Periodic water tile redraw
    if (this.redrawAccum >= 60) {
      this.redrawAccum = 0;
      this.redrawWater();
    }

    // Interpolate ships smoothly using SnapshotBuffer
    const renderTime = Date.now() - INTERPOLATION_DELAY_MS;
    for (const render of this.shipRenders.values()) {
      const sample = render.buffer.sample(renderTime);
      if (sample) {
        render.container.setPosition(sample.x * TILE_SIZE, sample.y * TILE_SIZE);
        render.hullGfx.setRotation(sample.hullAngle);
        render.turretGfx.setRotation(sample.turretAngle);
      }
    }

    // Render structures and enemies
    this.renderStructures();
    this.renderEnemies();
    this.renderWaypoints(delta);
  }

  private renderStructures(): void {
    const gfx = this.structuresGfx;
    gfx.clear();

    const state = spacetimeClient.getState();
    const structures: Structure[] = state.myStructures;

    for (const s of structures) {
      const px = s.gridX * TILE_SIZE;
      const py = s.gridY * TILE_SIZE;
      const pw = s.width * TILE_SIZE;
      const ph = s.height * TILE_SIZE;

      if (s.kind === "command_core") {
        // 3x3 Command Core Citadel
        gfx.fillStyle(0x0a2f3a, 0.95);
        gfx.fillRect(px, py, pw, ph);
        gfx.lineStyle(3, 0x06b6d4, 1);
        gfx.strokeRect(px, py, pw, ph);

        // Core Reactor Ring
        const cx = px + pw / 2;
        const cy = py + ph / 2;
        gfx.fillStyle(0x0891b2, 0.6);
        gfx.fillCircle(cx, cy, 38);
        gfx.lineStyle(2, 0x67e8f9, 1);
        gfx.strokeCircle(cx, cy, 38);
        gfx.fillStyle(0xecfeff, 0.9);
        gfx.fillCircle(cx, cy, 14);
      } else if (s.kind === "platform") {
        // Floating Platform Module
        gfx.fillStyle(0x132e35, 0.9);
        gfx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
        gfx.lineStyle(1.5, 0x22d3ee, 0.8);
        gfx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);

        // Platform deck bolts
        gfx.lineStyle(1, 0x0891b2, 0.4);
        gfx.lineBetween(px + 6, py + 6, px + pw - 6, py + ph - 6);
        gfx.lineBetween(px + pw - 6, py + 6, px + 6, py + ph - 6);
      } else {
        // Other structures (cannon, workshop, yard)
        gfx.fillStyle(0x0e3b43, 0.9);
        gfx.fillRect(px + 3, py + 3, pw - 6, ph - 6);
        gfx.lineStyle(2, 0x38bdf8, 0.9);
        gfx.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
      }
    }
  }

  private renderEnemies(): void {
    const gfx = this.enemiesGfx;
    gfx.clear();

    const state = spacetimeClient.getState();
    const enemies: DetectedEnemyContact[] = state.visibleEnemies;

    // Render authorized enemy sensor contacts (no secret data / HP)
    for (const enemy of enemies) {
      const ex = enemy.x * TILE_SIZE;
      const ey = enemy.y * TILE_SIZE;

      // Hostile red diamond contact blip
      gfx.fillStyle(0xef4444, 0.85);
      gfx.lineStyle(2, 0xfca5a5, 1);
      gfx.beginPath();
      gfx.moveTo(ex, ey - 14);
      gfx.lineTo(ex + 14, ey);
      gfx.lineTo(ex, ey + 14);
      gfx.lineTo(ex - 14, ey);
      gfx.closePath();
      gfx.fillPath();
      gfx.strokePath();

      // Hostile detection pulse
      const pulse = 16 + Math.sin(this.elapsed * 0.008) * 4;
      gfx.lineStyle(1, 0xef4444, 0.5);
      gfx.strokeCircle(ex, ey, pulse);
    }
  }

  private renderWaypoints(delta: number): void {
    const gfx = this.waypointsGfx;
    gfx.clear();

    if (!this.waypoint) return;

    this.waypoint.alpha -= delta * 0.0015;
    if (this.waypoint.alpha <= 0) {
      this.waypoint = null;
      return;
    }

    const { x, y, alpha } = this.waypoint;
    gfx.lineStyle(2, 0x38bdf8, alpha);
    gfx.strokeCircle(x, y, 16);
    gfx.lineBetween(x - 8, y, x + 8, y);
    gfx.lineBetween(x, y - 8, x, y + 8);
  }

  private redrawWater(): void {
    const gfx = this.waterGfx;
    if (!gfx) return;
    const { width, height } = this.scale;
    const camera = this.cameras.main;
    const zoom = camera.zoom;
    const minX = camera.scrollX;
    const minY = camera.scrollY;
    const spanX = width / zoom;
    const spanY = height / zoom;

    gfx.clear();
    gfx.fillStyle(0x071520, 1);
    gfx.fillRect(minX - 8, minY - 8, spanX + 16, spanY + 16);

    const tile = TILE_SIZE;
    const startX = Math.floor(minX / tile) * tile;
    const startY = Math.floor(minY / tile) * tile;
    const endX = minX + spanX + tile;
    const endY = minY + spanY + tile;

    // Grid lines
    gfx.lineStyle(1 / zoom, 0x1e3a47, 0.35);
    for (let x = startX; x < endX; x += tile) gfx.lineBetween(x, minY, x, endY);
    for (let y = startY; y < endY; y += tile) gfx.lineBetween(minX, y, endX, y);

    // Subtle wave flecks
    for (let gy = startY; gy < endY; gy += tile) {
      for (let gx = startX; gx < endX; gx += tile) {
        const wave = Math.sin(gx * 0.017 + gy * 0.033 + this.elapsed * 0.00045);
        if (wave < 0.15) continue;
        const offset = (wave + 1) * 10;
        gfx.lineStyle(1.5 / zoom, 0x38bdf8, 0.08 + wave * 0.08);
        gfx.lineBetween(gx + 8 + offset, gy + 22, gx + 20 + offset, gy + 22);
      }
    }
  }

  shutdown(): void {
    this.cleanup();
  }
}
