import Phaser from "phaser";
import { spacetimeClient, type SpacetimeClientState } from "../network/spacetime-client";
import { SnapshotBuffer, shouldRecordMotionSample, type MotionSnapshot } from "./motion/SnapshotBuffer";
import {
  GEMINI_TILE_SIZE as TILE,
  geminiFactionColor,
  geminiStructureTexture,
} from "./art/GeminiPixelArt";
import type { GeminiBattleShip, GeminiBattleStructure } from "../module_bindings/types";
import {
  structureDefinition, type BuildRequest, type StructureKind,
} from "../../spacetimedb/src/sim/construction";
import { decodeTerrainChunks } from "../../spacetimedb/src/sim/navigation";
import { planBoxConstruction } from "../../spacetimedb/src/sim/box-construction";

const INTERPOLATION_DELAY_MS = 100;
export const FOCUS_ENEMY_EVENT = "sea-siege:focus-enemy";
export const FOCUS_HOME_EVENT = "sea-siege:focus-home";
export const FOCUS_MAP_CELL_EVENT = "sea-siege:focus-map-cell";
export const GEMINI_BUILD_MODE_EVENT = "sea-siege:gemini-build-mode";
export const GEMINI_SELECTION_EVENT = "sea-siege:gemini-selection";
export const GEMINI_FEEDBACK_EVENT = "sea-siege:gemini-feedback";
export const GEMINI_BUILD_PREVIEW_EVENT = "sea-siege:gemini-build-preview";

interface VesselArt {
  container: Phaser.GameObjects.Container;
  hull: Phaser.GameObjects.Graphics;
  turret: Phaser.GameObjects.Graphics;
  highlight: Phaser.GameObjects.Graphics;
  wake: Phaser.GameObjects.Graphics;
  motion: SnapshotBuffer;
  lastSnapshot: MotionSnapshot | null;
  kind: string;
  slot: number;
}

interface BuildingArt {
  image: Phaser.GameObjects.Image;
  key: string;
}

interface LeftDrag {
  screenX: number;
  screenY: number;
  startWorldX: number;
  startWorldY: number;
  endWorldX: number;
  endWorldY: number;
  startCellX: number;
  startCellY: number;
  endCellX: number;
  endCellY: number;
  moved: boolean;
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
  private selectedShipIds = new Set<bigint>();
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private leftDrag: LeftDrag | null = null;
  private suppressRightUp = false;
  private buildKind: string | null = null;
  private buildPreview!: Phaser.GameObjects.Graphics;
  private cursorCell: { x: number; y: number } | null = null;
  private validatedTerrain: Uint8Array | null = null;
  private validatedMapCells = 0;
  private unsubscribeClient: (() => void) | null = null;
  private currentMatch: bigint | null = null;
  private centeredMatchId: bigint | null = null;
  private worldRevision = "";
  private depositAccum = 0;
  private waveAccum = 0;
  private oceanScrollX = Number.NaN;
  private oceanScrollY = Number.NaN;
  private oceanZoom = Number.NaN;
  private elapsed = 0;
  private drag: { x: number; y: number; scrollX: number; scrollY: number; moved: boolean } | null = null;

  constructor() { super({ key: "SeaScene" }); }

  create(): void {
    this.cameras.main.setBackgroundColor("#06131f");
    this.ocean = this.add.graphics().setDepth(0);
    this.terrain = this.add.graphics().setDepth(2);
    this.deposits = this.add.graphics().setDepth(4);
    this.markers = this.add.graphics().setDepth(31);
    this.buildPreview = this.add.graphics().setDepth(34);
    this.selectionGraphics = this.add.graphics().setDepth(35);
    this.cameras.main.setZoom(1);

    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!this.isWorldPointer(pointer)) return;
      const button = (pointer.event as MouseEvent).button;
      if (button === 2 && this.buildKind) {
        this.suppressRightUp = true;
        this.cancelBuilding();
        return;
      }
      if (button === 2 || button === 1) {
        this.drag = {
          x: pointer.x, y: pointer.y,
          scrollX: this.cameras.main.scrollX,
          scrollY: this.cameras.main.scrollY, moved: false,
        };
      }
      if (button !== 0) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.leftDrag = {
        screenX: pointer.x, screenY: pointer.y,
        startWorldX: world.x, startWorldY: world.y,
        endWorldX: world.x, endWorldY: world.y,
        startCellX: Math.floor(world.x / TILE),
        startCellY: Math.floor(world.y / TILE),
        endCellX: Math.floor(world.x / TILE),
        endCellY: Math.floor(world.y / TILE),
        moved: false,
      };
      if (this.buildKind) {
        this.cursorCell = {
          x: this.leftDrag.startCellX, y: this.leftDrag.startCellY,
        };
        this.drawBuildPreview();
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.isWorldPointer(pointer)) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (this.leftDrag) {
        const drag = this.leftDrag;
        drag.endWorldX = world.x;
        drag.endWorldY = world.y;
        drag.endCellX = Math.floor(world.x / TILE);
        drag.endCellY = Math.floor(world.y / TILE);
        if (Math.hypot(pointer.x - drag.screenX, pointer.y - drag.screenY) > 6)
          drag.moved = true;
        if (this.buildKind) {
          this.cursorCell = { x: drag.endCellX, y: drag.endCellY };
          this.drawBuildPreview();
        } else if (drag.moved) {
          this.drawSelectionBox(drag);
        }
      } else if (this.buildKind) {
        const x = Math.floor(world.x / TILE), y = Math.floor(world.y / TILE);
        if (this.cursorCell?.x !== x || this.cursorCell.y !== y) {
          this.cursorCell = { x, y };
          this.drawBuildPreview();
        }
      }
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
      const button = (pointer.event as MouseEvent).button;
      const isWorld = this.isWorldPointer(pointer);
      const pan = this.drag;
      const left = this.leftDrag;
      this.drag = null;
      this.leftDrag = null;
      this.selectionGraphics.clear();
      if (button === 2 && this.suppressRightUp) {
        this.suppressRightUp = false;
        return;
      }
      if (!isWorld) return;
      if (button === 0 && left?.moved) {
        if (this.buildKind) this.finishBoxBuild(left);
        else this.finishBoxSelection(left);
        return;
      }
      if (button !== 0 && pan?.moved) return;
      this.pointerCommand(pointer);
    });
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (!this.isWorldPointer(pointer)) return;
      this.cameras.main.setZoom(Phaser.Math.Clamp(
        this.cameras.main.zoom * (dy > 0 ? 0.91 : 1.09), 0.45, 2.4
      ));
    });

    window.addEventListener(FOCUS_ENEMY_EVENT, this.focusEnemy);
    window.addEventListener(FOCUS_HOME_EVENT, this.focusHome);
    window.addEventListener(FOCUS_MAP_CELL_EVENT, this.focusMapCell);
    window.addEventListener(GEMINI_BUILD_MODE_EVENT, this.onBuildMode);
    this.input.keyboard?.on("keydown-E", this.focusEnemy);
    this.input.keyboard?.on("keydown-H", this.focusHome);
    window.addEventListener("keydown", this.onEscape);
    window.addEventListener("contextmenu", this.onContextMenu, { capture: true });
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
    window.removeEventListener(GEMINI_BUILD_MODE_EVENT, this.onBuildMode);
    this.input.keyboard?.off("keydown-E", this.focusEnemy);
    this.input.keyboard?.off("keydown-H", this.focusHome);
    window.removeEventListener("keydown", this.onEscape);
    window.removeEventListener("contextmenu", this.onContextMenu, { capture: true });
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
    this.selectedShipIds.clear();
    this.selectionGraphics?.clear();
    this.leftDrag = null;
    this.selectEntity(null);
    this.cursorCell = null;
    this.buildKind = null;
    this.buildPreview?.clear();
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

  private onBuildMode = (event: Event): void => {
    const kind = (event as CustomEvent<{ kind: string | null }>).detail?.kind ?? null;
    this.buildKind = kind;
    this.leftDrag = null;
    this.cursorCell = null;
    this.selectionGraphics.clear();
    this.buildPreview.clear();
  };

  private cancelBuilding = (): void => {
    if (!this.buildKind) return;
    // The same event updates both Phaser and the React Construction Dock.
    window.dispatchEvent(new CustomEvent(GEMINI_BUILD_MODE_EVENT, {
      detail: { kind: null },
    }));
  };

  private onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (this.buildKind) {
      event.preventDefault();
      this.cancelBuilding();
    } else {
      this.selectShips([]);
    }
  };

  private onContextMenu = (event: MouseEvent): void => {
    if (this.buildKind) {
      event.preventDefault();
      this.cancelBuilding();
    }
  };

  private buildRequest(kind: string, gridX: number, gridY: number): BuildRequest | null {
    const state = spacetimeClient.getState();
    const slot = state.myMembership?.slot;
    if (!this.validatedTerrain || slot === undefined ||
        state.activeMatch?.phase !== "active") return null;
    return {
      kind: kind as StructureKind, ownerSlot: slot, gridX, gridY,
      salvage: state.myFaction?.salvage ?? 0,
      mapCells: this.validatedMapCells,
      terrain: this.validatedTerrain,
      structures: state.battleStructures.map(st => ({
        id: st.id, ownerSlot: st.ownerSlot, kind: st.kind as StructureKind,
        gridX: st.gridX, gridY: st.gridY,
        width: st.width, height: st.height, complete: st.complete,
      })),
      deposits: state.salvageNodes.map(n => ({ x: n.gridX, y: n.gridY })),
      hulls: state.battleShips.map(s => ({ x: s.x, y: s.y, radius: s.radiusCells })),
    };
  }

  private drawBuildPreview(): void {
    this.buildPreview.clear();
    if (!this.buildKind || !this.cursorCell) return;
    const kind = this.buildKind;
    const def = structureDefinition(kind);
    if (!def) return;
    const drag = this.leftDrag;
    const sx = drag?.startCellX ?? this.cursorCell.x;
    const sy = drag?.startCellY ?? this.cursorCell.y;
    const ex = this.cursorCell.x;
    const ey = this.cursorCell.y;
    const request = this.buildRequest(kind, sx, sy);
    const plan = request
      ? planBoxConstruction(request, ex, ey)
      : { reason: "World is not ready for construction", cells: [] };
    const color = plan.reason ? 0xef4444 : 0x22c55e;
    this.buildPreview.fillStyle(color, 0.23);
    this.buildPreview.lineStyle(2, color, 0.9);
    if (plan.reason) {
      const x = Math.min(sx, ex) * TILE;
      const y = Math.min(sy, ey) * TILE;
      const width = (Math.abs(ex - sx) + def.width) * TILE;
      const height = (Math.abs(ey - sy) + def.height) * TILE;
      this.buildPreview.fillRect(x, y, width, height);
      this.buildPreview.strokeRect(x, y, width, height);
    } else {
      for (const cell of plan.cells) {
        const x = cell.gridX * TILE, y = cell.gridY * TILE;
        this.buildPreview.fillRect(x, y, def.width * TILE, def.height * TILE);
        this.buildPreview.strokeRect(x, y, def.width * TILE, def.height * TILE);
      }
    }
    window.dispatchEvent(new CustomEvent(GEMINI_BUILD_PREVIEW_EVENT, {
      detail: {
        reason: plan.reason, count: plan.cells.length,
        x: sx, y: sy, endX: ex, endY: ey,
      },
    }));
  }

  private drawSelectionBox(drag: LeftDrag): void {
    const x = Math.min(drag.startWorldX, drag.endWorldX);
    const y = Math.min(drag.startWorldY, drag.endWorldY);
    const w = Math.abs(drag.endWorldX - drag.startWorldX);
    const h = Math.abs(drag.endWorldY - drag.startWorldY);
    this.selectionGraphics.clear();
    this.selectionGraphics.fillStyle(0x38bdf8, 0.14);
    this.selectionGraphics.fillRect(x, y, w, h);
    this.selectionGraphics.lineStyle(2, 0x67e8f9, 0.9);
    this.selectionGraphics.strokeRect(x, y, w, h);
  }

  private finishBoxSelection(drag: LeftDrag): void {
    const left = Math.min(drag.startWorldX, drag.endWorldX);
    const top = Math.min(drag.startWorldY, drag.endWorldY);
    const right = Math.max(drag.startWorldX, drag.endWorldX);
    const bottom = Math.max(drag.startWorldY, drag.endWorldY);
    const ids = spacetimeClient.getState().myShips
      .filter(ship => {
        const art = this.vessels.get(ship.id);
        const x = art?.container.x ?? ship.x * TILE;
        const y = art?.container.y ?? ship.y * TILE;
        const radius = ship.radiusCells * TILE;
        return x + radius >= left && x - radius <= right &&
          y + radius >= top && y - radius <= bottom;
      })
      .map(ship => ship.id)
      .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    // Dragging across an empty region replaces the selection with nothing.
    this.selectShips(ids);
  }

  private finishBoxBuild(drag: LeftDrag): void {
    if (!this.buildKind) return;
    const request = this.buildRequest(this.buildKind, drag.startCellX, drag.startCellY);
    const plan = request
      ? planBoxConstruction(request, drag.endCellX, drag.endCellY)
      : { reason: "World is not ready for construction", cells: [] };
    if (plan.reason) { this.reportOrderError(plan.reason); return; }
    const kind = this.buildKind;
    spacetimeClient.placeStructuresBox(
      kind, drag.startCellX, drag.startCellY, drag.endCellX, drag.endCellY,
    ).then(() => {
      window.dispatchEvent(new CustomEvent(GEMINI_FEEDBACK_EVENT, {
        detail: {
          message: `${plan.cells.length} × ${kind} structures queued`,
          success: true,
        },
      }));
      this.drawBuildPreview();
    }).catch(err => this.reportOrderError(err));
  }

  private selectShips(ids: readonly bigint[]): void {
    this.selectedShipIds = new Set(ids);
    this.selectedShipId = ids[0] ?? null;
    window.dispatchEvent(new CustomEvent(GEMINI_SELECTION_EVENT, {
      detail: ids.length
        ? { type: "ship", id: ids[0], shipIds: [...ids] }
        : null,
    }));
  }

  private selectEntity(type: "ship" | "structure" | null, id?: bigint): void {
    if (type === "ship" && id !== undefined) {
      this.selectShips([id]);
    } else if (type === "structure" && id !== undefined) {
      this.selectedShipIds.clear();
      this.selectedShipId = null;
      window.dispatchEvent(new CustomEvent(GEMINI_SELECTION_EVENT, {
        detail: { type: "structure", id },
      }));
    } else {
      this.selectShips([]);
    }
  }

  private reportOrderError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    window.dispatchEvent(new CustomEvent(GEMINI_FEEDBACK_EVENT, { detail: { message } }));
    console.warn("Server rejected gameplay command:", message);
  }

  /**
   * Phaser can receive global pointer-up events even when React overlays are
   * visible. Only input whose native target AND hit-tested topmost element are
   * the actual game canvas is a valid world command.
   */
  private isWorldPointer(pointer: Phaser.Input.Pointer): boolean {
    const event = pointer.event as MouseEvent | undefined;
    if (!event || event.target !== this.game.canvas) return false;
    return document.elementFromPoint(event.clientX, event.clientY) === this.game.canvas;
  }

  private pointerCommand(pointer: Phaser.Input.Pointer): void {
    if (!this.isWorldPointer(pointer)) return;
    const state = spacetimeClient.getState();
    if (state.activeMatch?.phase !== "active") return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = world.x / TILE, y = world.y / TILE;
    // Use the native released mouse button. Phaser's "leftButtonReleased"
    // reflects aggregate button state and can misinterpret pointer-up input.
    const button = (pointer.event as MouseEvent).button;
    if (this.buildKind) {
      if (button !== 0) return;
      const gridX = Math.floor(x), gridY = Math.floor(y);
      const request = this.buildRequest(this.buildKind, gridX, gridY);
      const plan = request
        ? planBoxConstruction(request, gridX, gridY)
        : { reason: "World is not ready for construction", cells: [] };
      if (plan.reason) {
        this.reportOrderError(plan.reason);
        return;
      }
      const kind = this.buildKind;
      spacetimeClient.placeStructure(kind, gridX, gridY).then(() => {
        window.dispatchEvent(new CustomEvent(GEMINI_FEEDBACK_EVENT, {
          detail: { message: kind + " construction queued", success: true },
        }));
        this.drawBuildPreview();
      }).catch(err => this.reportOrderError(err));
      return;
    }
    if (button === 0) {
      const hit = state.myShips.find(ship => {
        const art = this.vessels.get(ship.id);
        const px = art ? art.container.x / TILE : ship.x;
        const py = art ? art.container.y / TILE : ship.y;
        return Math.hypot(x - px, y - py) <= ship.radiusCells + 0.5;
      });
      if (hit) {
        this.selectedShipId = hit.id;
        this.selectEntity("ship", hit.id);
        return;
      }

      const ownSlot = state.myMembership?.slot;
      const chosen = state.battleStructures.find(st =>
        st.ownerSlot === ownSlot &&
        x >= st.gridX && x < st.gridX + st.width &&
        y >= st.gridY && y < st.gridY + st.height
      );
      if (chosen) {
        this.selectEntity("structure", chosen.id);
        return;
      }
      // Left-click empty sea or drag an empty box: clear the prior selection.
      this.selectShips([]);
      return;
    }

    if (this.selectedShipId !== null && button === 2) {
      const node = state.salvageNodes.find(n =>
        n.remaining > 0 && Math.abs(x - n.gridX - 0.5) < 0.8 &&
        Math.abs(y - n.gridY - 0.5) < 0.8
      );
      if (node) {
        const ship = state.myShips.find(s => s.id === this.selectedShipId);
        if (ship && Math.hypot(ship.x - node.gridX - 0.5, ship.y - node.gridY - 0.5) <= 3.5) {
          spacetimeClient.orderHarvest(ship.id, node.id)
            .catch(err => this.reportOrderError(err));
        } else if (ship) {
          spacetimeClient.issueShipOrder(ship.id, node.gridX + 0.5, node.gridY + 0.5)
            .catch(err => this.reportOrderError(err));
        }
        return;
      }
    }
    // Box-selected fleets receive independent authoritative move orders.
    // Give each vessel a small formation offset, rather than stacking every
    // collision hull onto precisely the same endpoint.
    if (this.selectedShipIds.size && button === 2) {
      const ids = [...this.selectedShipIds];
      this.drawOrderMarker(x, y);
      const columns = Math.ceil(Math.sqrt(ids.length));
      const spacing = 1.5;
      void Promise.allSettled(ids.map((shipId, i) => {
        const dx = (i % columns - (columns - 1) / 2) * spacing;
        const dy = (Math.floor(i / columns) -
          (Math.ceil(ids.length / columns) - 1) / 2) * spacing;
        return spacetimeClient.issueShipOrder(
          shipId, Math.round((x + dx) * 10) / 10,
          Math.round((y + dy) * 10) / 10,
        );
      })).then(results => {
        const failures = results.filter(r => r.status === "rejected");
        if (failures.length) this.reportOrderError(
          `${failures.length} of ${ids.length} move orders were rejected`
        );
      });
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
      this.centeredMatchId = null;
      this.worldRevision = "";
      this.validatedTerrain = null;
      this.validatedMapCells = 0;
      this.clearEntities();
      this.terrain.clear();
      this.deposits.clear();
      if (matchId !== null) this.focusHome();
    }
    if (!state.activeMatch || state.activeMatch.phase !== "active") return;
    this.syncMap(state);
    this.syncBuildings(state.battleStructures);
    this.syncShips(state.battleShips);
    if (this.centeredMatchId !== matchId && state.myStructures
      .some(st => st.kind === "command_core")) {
      this.focusHome();
      this.centeredMatchId = matchId;
    }
  }

  private syncMap(state: SpacetimeClientState): void {
    const chunks = state.worldChunks;
    if (!chunks.length) return;
    const signature = state.activeMatchId?.toString() + ":" +
      chunks.map(chunk => chunk.chunkKey).sort().join("|");
    if (this.worldRevision === signature) return;
    this.worldRevision = signature;
    const cells = chunks[0]!.mapCells;
    this.validatedMapCells = cells;
    this.validatedTerrain = decodeTerrainChunks(cells, chunks.map(chunk => ({
      chunkX: chunk.chunkX, chunkY: chunk.chunkY,
      terrain: Array.from(chunk.terrain),
    })));
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
          motion: new SnapshotBuffer({ capacity: 16, maxExtrapolationMs: 120 }),
          lastSnapshot: null, kind: "", slot: -1,
        };
        this.vessels.set(ship.id, art);
      }
      if (art.kind !== ship.kind || art.slot !== ship.ownerSlot) {
        art.kind = ship.kind;
        art.slot = ship.ownerSlot;
        this.drawVessel(art, ship);
      }
      // Motion schedule updates position/velocity WITHOUT incrementing the
      // command revision. The previous condition ignored a final zero-speed
      // arrival, then snapped to the real endpoint when the next order bumped
      // revision. Compare authoritative KINEMATICS, not just order revision.
      // Also avoid appending fake duplicate samples during unrelated table updates.
      const previous = art.lastSnapshot;
      const sample: MotionSnapshot = {
        timeMs: Math.max(now, (previous?.timeMs ?? 0) + 1),
        revision: Number(ship.revision),
        x: ship.x, y: ship.y, vx: ship.velocityX, vy: ship.velocityY,
        hullAngle: ship.hullAngleDeg * Math.PI / 180,
        turretAngle: ship.turretAngleDeg * Math.PI / 180,
      };
      if (shouldRecordMotionSample(previous, sample)) {
        art.motion.push(sample);
        art.lastSnapshot = sample;
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
    const camera = this.cameras.main;
    // Don't let quick camera drags or zoom expose an unpainted world edge.
    // Waves still animate at their low-cost cadence while the camera is idle.
    if (this.waveAccum >= 110 ||
        Math.abs(camera.scrollX - this.oceanScrollX) > TILE ||
        Math.abs(camera.scrollY - this.oceanScrollY) > TILE ||
        camera.zoom !== this.oceanZoom) {
      this.waveAccum = 0;
      this.redrawOcean();
      this.oceanScrollX = camera.scrollX;
      this.oceanScrollY = camera.scrollY;
      this.oceanZoom = camera.zoom;
    }
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
      if (ship.ownerSlot === ownSlot && this.selectedShipIds.has(ship.id)) {
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
    // Infinite *visual* ocean. The server map remains finite for commands;
    // water extends beyond its edges wherever the camera can see.
    const camera = this.cameras.main;
    const startX = Math.floor(camera.scrollX / TILE) - 2;
    const startY = Math.floor(camera.scrollY / TILE) - 2;
    const endX = Math.ceil((camera.scrollX + this.scale.width / camera.zoom) / TILE) + 3;
    const endY = Math.ceil((camera.scrollY + this.scale.height / camera.zoom) / TILE) + 3;
    this.ocean.clear();
    this.ocean.fillStyle(0x06131f, 1);
    this.ocean.fillRect(startX * TILE, startY * TILE,
      (endX - startX) * TILE, (endY - startY) * TILE);
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
