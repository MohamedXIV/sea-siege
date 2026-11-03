import Phaser from "phaser";
import { spacetimeClient, type SpacetimeClientState } from "../network/spacetime-client";
import { SnapshotBuffer } from "./motion/SnapshotBuffer";
import {
  GEMINI_TILE_SIZE as TILE,
  geminiFactionColor,
  geminiStructureTexture,
} from "./art/GeminiPixelArt";
import type { GeminiBattleShip, GeminiBattleStructure } from "../module_bindings/types";

const INTERPOLATION_DELAY_MS = 100;
export const FOCUS_ENEMY_EVENT = "sea-siege:focus-enemy";
export const FOCUS_HOME_EVENT = "sea-siege:focus-home";
export const FOCUS_MAP_CELL_EVENT = "sea-siege:focus-map-cell";

interface VesselArt {
  container: Phaser.GameObjects.Container;
  hull: Phaser.GameObjects.Graphics;
  turret: Phaser.GameObjects.Graphics;
  highlight: Phaser.GameObjects.Graphics;
  wake: Phaser.GameObjects.Graphics;
  motion: SnapshotBuffer;
  revision: bigint;
  kind: string;
  slot: number;
}

interface BuildingArt {
  image: Phaser.GameObjects.Image;
  key: string;
}

/**
 * Gemini's original 40px pixel-art/water/ship silhouettes ported into a REAL
 * Phaser 4 scene. This scene never simulates combat, economy, terrain or AI:
 * those rules remain in SpacetimeDB, and only member-scoped rows are drawn.
 */
export class SeaScene extends Phaser.Scene {
  private ocean!: Phaser.GameObjects.Graphics;
  private terrain!: Phaser.GameObjects.Graphics;
  private deposits!: Phaser.GameObjects.Graphics;
  private markers!: Phaser.GameObjects.Graphics;
  private vessels = new Map<bigint, VesselArt>();
  private buildings = new Map<bigint, BuildingArt>();
  private selectedShipId: bigint | null = null;
  private unsubscribeClient: (() => void) | null = null;
  private currentMatch: bigint | null = null;
  private worldRevision = "";
  private depositAccum = 0;
  private waveAccum = 0;
  private elapsed = 0;
  private drag: { x: number; y: number; scrollX: number; scrollY: number; moved: boolean } | null = null;

  constructor() { super({ key: "SeaScene" }); }

  create(): void {
    this.cameras.main.setBackgroundColor("#06131f");
    this.ocean = this.add.graphics().setDepth(0);
    this.terrain = this.add.graphics().setDepth(2);
    this.deposits = this.add.graphics().setDepth(4);
    this.markers = this.add.graphics().setDepth(31);
    this.cameras.main.setZoom(1);

    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.middleButtonDown() && !pointer.rightButtonDown()) return;
      this.drag = {
        x: pointer.x, y: pointer.y,
        scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY,
        moved: false,
      };
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.drag) return;
      const dx = pointer.x - this.drag.x;
      const dy = pointer.y - this.drag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.drag.moved = true;
      this.cameras.main.setScroll(
        this.drag.scrollX - dx / this.cameras.main.zoom,
        this.drag.scrollY - dy / this.cameras.main.zoom,
      );
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const moved = this.drag?.moved;
      this.drag = null;
      if (!moved) this.pointerCommand(pointer);
    });
    this.input.on("wheel", (_p: unknown, _over: unknown, _dx: number, dy: number) => {
      this.cameras.main.setZoom(Phaser.Math.Clamp(
        this.cameras.main.zoom * (dy > 0 ? 0.91 : 1.09), 0.45, 2.4
      ));
    });

    window.addEventListener(FOCUS_ENEMY_EVENT, this.focusEnemy);
    window.addEventListener(FOCUS_HOME_EVENT, this.focusHome);
    window.addEventListener(FOCUS_MAP_CELL_EVENT, this.focusMapCell);
    this.input.keyboard?.on("keydown-E", this.focusEnemy);
    this.input.keyboard?.on("keydown-H", this.focusHome);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());

    this.unsubscribeClient = spacetimeClient.subscribeEntities(() => this.sync());
    this.sync();
  }

  private cleanup(): void {
    this.unsubscribeClient?.();
    this.unsubscribeClient = null;
    window.removeEventListener(FOCUS_ENEMY_EVENT, this.focusEnemy);
    window.removeEventListener(FOCUS_HOME_EVENT, this.focusHome);
    window.removeEventListener(FOCUS_MAP_CELL_EVENT, this.focusMapCell);
    this.input.keyboard?.off("keydown-E", this.focusEnemy);
    this.input.keyboard?.off("keydown-H", this.focusHome);
    this.clearEntities();
  }

  private clearEntities(): void {
    for (const art of this.vessels.values()) {
      art.motion.clear();
      art.container.destroy();
    }
    this.vessels.clear();
    for (const art of this.buildings.values()) art.image.destroy();
    this.buildings.clear();
    this.selectedShipId = null;
  }

  private focusHome = (): void => {
    const core = spacetimeClient.getState().myStructures.find(st => st.kind === "command_core");
    if (core) this.cameras.main.centerOn((core.gridX + core.width / 2) * TILE,
      (core.gridY + core.height / 2) * TILE);
  };

  private focusEnemy = (): void => {
    const state = spacetimeClient.getState();
    const slot = state.myMembership?.slot;
    const core = state.battleStructures.find(st =>
      st.ownerSlot !== slot && st.kind === "command_core");
    const target = core ?? state.battleShips.find(ship => ship.ownerSlot !== slot);
    if (!target) return;
    const x = "gridX" in target ? target.gridX + target.width / 2 : target.x;
    const y = "gridY" in target ? target.gridY + target.height / 2 : target.y;
    this.cameras.main.centerOn(x * TILE, y * TILE);
  };

  private focusMapCell = (event: Event): void => {
    const p = (event as CustomEvent<{ x: number; y: number }>).detail;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      this.cameras.main.centerOn(p.x * TILE, p.y * TILE);
  };

  private pointerCommand(pointer: Phaser.Input.Pointer): void {
    const state = spacetimeClient.getState();
    if (state.activeMatch?.phase !== "active") return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = world.x / TILE, y = world.y / TILE;
    if (pointer.leftButtonReleased()) {
      const hit = state.myShips.find(ship => {
        const art = this.vessels.get(ship.id);
        const px = art ? art.container.x / TILE : ship.x;
        const py = art ? art.container.y / TILE : ship.y;
        return Math.hypot(x - px, y - py) <= ship.radiusCells + 0.5;
      });
      if (hit) {
        this.selectedShipId = hit.id;
        return;
      }
    }
    if (this.selectedShipId !== null &&
        (pointer.leftButtonReleased() || pointer.rightButtonReleased())) {
      const shipId = this.selectedShipId;
      const targetX = Math.round(x * 10) / 10;
      const targetY = Math.round(y * 10) / 10;
      this.drawOrderMarker(targetX, targetY);
      spacetimeClient.issueShipOrder(shipId, targetX, targetY).catch(err =>
        console.warn("Server rejected move order:", err));
    }
  }

  private drawOrderMarker(x: number, y: number): void {
    this.markers.clear();
    this.markers.lineStyle(2, 0x38bdf8, 0.95);
    this.markers.strokeCircle(x * TILE, y * TILE, 13);
    this.markers.lineBetween(x * TILE - 6, y * TILE, x * TILE + 6, y * TILE);
    this.markers.lineBetween(x * TILE, y * TILE - 6, x * TILE, y * TILE + 6);
    this.time.delayedCall(900, () => this.markers.clear());
  }

  private sync(): void {
    if (!this.add || !this.sys) return;
    const state = spacetimeClient.getState();
    const matchId = state.activeMatch?.id ?? null;
    if (matchId !== this.currentMatch) {
      this.currentMatch = matchId;
      this.worldRevision = "";
      this.clearEntities();
      this.terrain.clear();
      this.deposits.clear();
      if (matchId !== null) this.focusHome();
    }
    if (!state.activeMatch || state.activeMatch.phase !== "active") return;
    this.syncMap(state);
    this.syncBuildings(state.battleStructures);
    this.syncShips(state.battleShips);
    if (state.myStructures.length > 0 && this.cameras.main.scrollX === 0 &&
        this.cameras.main.scrollY === 0) this.focusHome();
  }

  private syncMap(state: SpacetimeClientState): void {
    const chunks = state.worldChunks;
    if (!chunks.length) return;
    const signature = state.activeMatchId?.toString() + ":" +
      chunks.map(chunk => chunk.chunkKey).sort().join("|");
    if (this.worldRevision === signature) return;
    this.worldRevision = signature;
    const cells = chunks[0]!.mapCells;
    this.cameras.main.setBounds(0, 0, cells * TILE, cells * TILE);
    this.terrain.clear();
    for (const chunk of chunks) {
      for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
        const gx = chunk.chunkX * 16 + lx;
        const gy = chunk.chunkY * 16 + ly;
        if (gx >= cells || gy >= cells) continue;
        const kind = chunk.terrain[ly * 16 + lx];
        const px = gx * TILE, py = gy * TILE;
        if (kind === 1) { // Gemini SHALLOW_WATER
          this.terrain.fillStyle(0x145374, 0.42);
          this.terrain.fillRect(px, py, TILE, TILE);
        } else if (kind === 2) { // Gemini RUINED_PILLAR
          this.terrain.fillStyle(0xbae6fd, 0.28);
          this.terrain.fillRect(px - 2, py - 2, TILE + 4, TILE + 4);
          this.terrain.fillStyle(0x1e293b, 1);
          this.terrain.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
          this.terrain.fillStyle(0x334155, 1);
          this.terrain.fillRect(px + 4, py + 4, TILE - 8, TILE - 12);
          this.terrain.fillStyle(0x7c2d12, 1);
          this.terrain.fillRect(px + 8, py + 8, 10, 8);
        } else if (kind === 3) { // Gemini WRECKAGE_SHOAL
          this.terrain.fillStyle(0xbae6fd, 0.22);
          this.terrain.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
          this.terrain.fillStyle(0x451a03, 1);
          this.terrain.fillRect(px + 6, py + 8, TILE - 12, TILE - 16);
          this.terrain.fillStyle(0x9a3412, 1);
          this.terrain.fillRect(px + 10, py + 12, TILE - 20, 8);
        }
      }
    }
    this.redrawDeposits();
  }

  private redrawDeposits(): void {
    const gfx = this.deposits;
    const nodes = spacetimeClient.getState().salvageNodes;
    gfx.clear();
    for (const node of nodes) {
      if (node.remaining === 0) continue;
      const px = node.gridX * TILE, py = node.gridY * TILE;
      const pulse = 0.7 + 0.3 * Math.sin(this.elapsed * 0.005 + node.gridX);
      gfx.lineStyle(2, node.contested ? 0xf97316 : 0xeab308, pulse);
      gfx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
      gfx.fillStyle(0x422006, 1);
      gfx.fillRect(px + 7, py + 7, TILE - 14, TILE - 14);
      gfx.fillStyle(node.contested ? 0xf97316 : 0xeab308, 1);
      gfx.fillRect(px + 11, py + 11, 8, 8);
      gfx.fillRect(px + 21, py + 19, 7, 7);
    }
  }

  private syncBuildings(buildings: readonly GeminiBattleStructure[]): void {
    const alive = new Set(buildings.map(st => st.id));
    for (const [id, art] of this.buildings) {
      if (!alive.has(id)) { art.image.destroy(); this.buildings.delete(id); }
    }
    for (const st of buildings) {
      const key = geminiStructureTexture(this, st.kind, st.ownerSlot, st.connected, st.complete);
      let art = this.buildings.get(st.id);
      if (!art) {
        const image = this.add.image(st.gridX * TILE, st.gridY * TILE, key)
          .setOrigin(0, 0).setDepth(10);
        art = { image, key };
        this.buildings.set(st.id, art);
      } else {
        if (art.key !== key) { art.image.setTexture(key); art.key = key; }
        art.image.setPosition(st.gridX * TILE, st.gridY * TILE);
      }
    }
  }

  private syncShips(ships: readonly GeminiBattleShip[]): void {
    const alive = new Set(ships.map(ship => ship.id));
    for (const [id, art] of this.vessels) {
      if (!alive.has(id)) {
        art.motion.clear();
        art.container.destroy();
        this.vessels.delete(id);
        if (this.selectedShipId === id) this.selectedShipId = null;
      }
    }
    const now = Date.now();
    for (const ship of ships) {
      let art = this.vessels.get(ship.id);
      if (!art) {
        const container = this.add.container(ship.x * TILE, ship.y * TILE).setDepth(25);
        const wake = this.add.graphics();
        const highlight = this.add.graphics();
        const hull = this.add.graphics();
        const turret = this.add.graphics();
        container.add([wake, highlight, hull, turret]);
        art = {
          container, hull, turret, highlight, wake,
          motion: new SnapshotBuffer({ capacity: 16, maxExtrapolationMs: 250 }),
          revision: -1n, kind: "", slot: -1,
        };
        this.vessels.set(ship.id, art);
      }
      if (art.kind !== ship.kind || art.slot !== ship.ownerSlot) {
        art.kind = ship.kind;
        art.slot = ship.ownerSlot;
        this.drawVessel(art, ship);
      }
      if (art.revision !== ship.revision || ship.velocityX || ship.velocityY) {
        art.revision = ship.revision;
        art.motion.push({
          timeMs: now, revision: Number(ship.revision),
          x: ship.x, y: ship.y,
          vx: ship.velocityX, vy: ship.velocityY,
          hullAngle: ship.hullAngleDeg * Math.PI / 180,
          turretAngle: ship.turretAngleDeg * Math.PI / 180,
        });
      }
    }
  }

  private drawVessel(art: VesselArt, ship: GeminiBattleShip): void {
    const gfx = art.hull;
    gfx.clear();
    const accent = Number.parseInt(geminiFactionColor(ship.ownerSlot).slice(1), 16);
    // Original Gemini orthogonal pixel hulls: Scout 24x14, Gunboat 32x20,
    // Siege Monitor 42x26. No placeholder triangles.
    const isScout = ship.kind === "scout";
    const isGunboat = ship.kind === "gunboat";
    const w = isScout ? 24 : isGunboat ? 32 : 42;
    const h = isScout ? 14 : isGunboat ? 20 : 26;
    gfx.fillStyle(isScout ? 0x1e293b : isGunboat ? 0x0f172a : 0x090d16, 1);
    gfx.fillRect(-w / 2, -h / 2, w, h);
    gfx.fillStyle(isScout ? accent : isGunboat ? 0x475569 : 0x334155, 1);
    gfx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
    gfx.fillStyle(accent, 1);
    gfx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8);
    const turret = art.turret;
    turret.clear();
    turret.fillStyle(0x0f172a, 1);
    turret.fillRect(-5, -5, 10, 10);
    turret.fillStyle(0xe2e8f0, 1);
    turret.fillRect(0, -2.5, isScout ? 10 : isGunboat ? 14 : 18, 5);
  }

  update(_time: number, delta: number): void {
    this.elapsed += delta;
    this.waveAccum += delta;
    this.depositAccum += delta;
    if (this.waveAccum >= 110) { this.waveAccum = 0; this.redrawOcean(); }
    if (this.depositAccum >= 240) { this.depositAccum = 0; this.redrawDeposits(); }

    const state = spacetimeClient.getState();
    const ownSlot = state.myMembership?.slot;
    const sampleTime = Date.now() - INTERPOLATION_DELAY_MS;
    for (const ship of state.battleShips) {
      const art = this.vessels.get(ship.id);
      if (!art) continue;
      const sample = art.motion.sample(sampleTime);
      if (sample) {
        art.container.setPosition(sample.x * TILE, sample.y * TILE);
        art.hull.setRotation(sample.hullAngle);
        art.turret.setRotation(sample.turretAngle);
      }
      art.highlight.clear();
      if (ship.ownerSlot === ownSlot && ship.id === this.selectedShipId) {
        art.highlight.lineStyle(2, 0x38bdf8, 1);
        art.highlight.strokeCircle(0, 0, 19);
      }
      art.wake.clear();
      if (Math.hypot(ship.velocityX, ship.velocityY) > 0.2) {
        art.wake.lineStyle(2, 0xbae6fd, 0.3 + 0.2 * Math.sin(this.elapsed * 0.01));
        art.wake.strokeCircle(-18, 0, 6);
      }
    }
  }

  private redrawOcean(): void {
    if (!this.ocean) return;
    const state = spacetimeClient.getState();
    const cells = state.worldChunks[0]?.mapCells ?? 56;
    const camera = this.cameras.main;
    const startX = Math.max(0, Math.floor(camera.scrollX / TILE) - 1);
    const startY = Math.max(0, Math.floor(camera.scrollY / TILE) - 1);
    const endX = Math.min(cells, Math.ceil((camera.scrollX + this.scale.width / camera.zoom) / TILE) + 2);
    const endY = Math.min(cells, Math.ceil((camera.scrollY + this.scale.height / camera.zoom) / TILE) + 2);
    this.ocean.clear();
    this.ocean.fillStyle(0x06131f, 1);
    this.ocean.fillRect(0, 0, cells * TILE, cells * TILE);
    const t = this.elapsed * 0.0012;
    for (let gy = startY; gy < endY; gy++) for (let gx = startX; gx < endX; gx++) {
      const v = Math.sin(gx * 0.35 + t) * 0.5 +
        Math.cos(gy * 0.28 - t * 0.8) * 0.5 +
        Math.sin((gx + gy) * 0.2 + t * 0.6) * 0.3;
      const x = gx * TILE, y = gy * TILE;
      if (v > 0.55) {
        this.ocean.fillStyle(0x0c273c, 1);
        this.ocean.fillRect(x, y, TILE, TILE);
        if (v > 0.85) {
          this.ocean.fillStyle(0x94d2e8, 0.16);
          this.ocean.fillRect(x + 6, y + 14, 14, 3);
        }
      } else if (v > -0.15) {
        this.ocean.fillStyle(0x081c2c, 1);
        this.ocean.fillRect(x, y, TILE, TILE);
      }
      this.ocean.lineStyle(1, 0x38bdf8, 0.04);
      this.ocean.strokeRect(x, y, TILE, TILE);
    }
  }
}
