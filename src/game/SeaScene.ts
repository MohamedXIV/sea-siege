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
import { shipsInSelectionBox } from "./input/selection-box";
import { selectStructureAt } from "./input/structure-selection";
import { resolveRightClickCommand, type RightClickCommand } from "./input/command-target";
import { ECONOMY_RULES } from "../../spacetimedb/src/sim/economy";
import {
  RESOURCE_TYPES, type AdvancedResourceKind,
} from "../../spacetimedb/src/sim/materials";

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
  hp: number;
}

interface BuildingArt {
  image: Phaser.GameObjects.Image;
  key: string;
  hp: number;
}

interface ProjectileArt {
  displayX: number;
  displayY: number;
  serverX: number;
  serverY: number;
  vx: number;
  vy: number;
  observedAtMs: number;
  sourceFaction: number;
}

interface CombatEffect {
  kind: "muzzle" | "splash" | "hit" | "explosion";
  x: number;
  y: number;
  age: number;
  duration: number;
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
  private combatGraphics!: Phaser.GameObjects.Graphics;
  private projectileGraphics!: Phaser.GameObjects.Graphics;
  private effectsGraphics!: Phaser.GameObjects.Graphics;
  private projectiles = new Map<bigint, ProjectileArt>();
  private seenImpactIds = new Set<bigint>();
  private effects: CombatEffect[] = [];
  private attackTargets = new Map<bigint, { targetType: string; targetId: bigint }>();
  private vessels = new Map<bigint, VesselArt>();
  private buildings = new Map<bigint, BuildingArt>();
  private selectedShipId: bigint | null = null;
  private selectedShipIds = new Set<bigint>();
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private buildingSelectionGraphics!: Phaser.GameObjects.Graphics;
  private selectedBuildingId: bigint | null = null;
  private leftDrag: LeftDrag | null = null;
  private suppressRightUp = false;
  private suppressLeftUp = false;
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
    this.combatGraphics = this.add.graphics().setDepth(30);
    this.markers = this.add.graphics().setDepth(31);
    this.projectileGraphics = this.add.graphics().setDepth(26);
    this.effectsGraphics = this.add.graphics().setDepth(27);
    this.buildPreview = this.add.graphics().setDepth(34);
    this.selectionGraphics = this.add.graphics().setDepth(35);
    this.buildingSelectionGraphics = this.add.graphics().setDepth(33);
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
        const oldCellX = drag.endCellX;
        const oldCellY = drag.endCellY;
        drag.endWorldX = world.x;
        drag.endWorldY = world.y;
        drag.endCellX = Math.floor(world.x / TILE);
        drag.endCellY = Math.floor(world.y / TILE);
        if (Math.hypot(pointer.x - drag.screenX, pointer.y - drag.screenY) > 6)
          drag.moved = true;
        if (this.buildKind) {
          if (drag.endCellX !== oldCellX || drag.endCellY !== oldCellY) {
            this.cursorCell = { x: drag.endCellX, y: drag.endCellY };
            // O(n) occupancy checks only when the destination CELL changes,
            // not 60 times/sec during a continuous pointer drag.
            this.drawBuildPreview();
          }
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
      if (button === 0 && this.suppressLeftUp) {
        this.suppressLeftUp = false;
        return;
      }
      // A gesture starting over React UI and ending over the canvas must
      // never become a click / move order.
      if (button === 0 && !left) return;
      if (button === 2 && !pan) return;
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
    this.scale.on(Phaser.Scale.Events.RESIZE, this.redrawOcean, this);
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
    this.scale.off(Phaser.Scale.Events.RESIZE, this.redrawOcean, this);
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
    this.projectiles.clear();
    this.seenImpactIds.clear();
    this.projectileGraphics?.clear();
    this.effects = [];
    this.effectsGraphics?.clear();
    this.attackTargets.clear();
    this.combatGraphics?.clear();
    this.selectedShipId = null;
    this.selectedShipIds.clear();
    this.selectionGraphics?.clear();
    this.buildingSelectionGraphics?.clear();
    this.selectedBuildingId = null;
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
    if (this.leftDrag) this.suppressLeftUp = true;
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
      deposits: [
        ...state.salvageNodes.map(n => ({ x: n.gridX, y: n.gridY })),
        ...state.materialDeposits.map(n => ({ x: n.gridX, y: n.gridY })),
      ],
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
    const ships = spacetimeClient.getState().myShips.map(ship => {
      const art = this.vessels.get(ship.id);
      return {
        id: ship.id,
        x: art?.container.x ?? ship.x * TILE,
        y: art?.container.y ?? ship.y * TILE,
        radius: ship.radiusCells * TILE,
      };
    });
    const ids = shipsInSelectionBox({
      fromX: drag.startWorldX, fromY: drag.startWorldY,
      toX: drag.endWorldX, toY: drag.endWorldY,
    }, ships);
    // Dragging across empty sea intentionally clears the selection.
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
      if (kind !== "platform" && this.buildKind === kind) this.cancelBuilding();
      else this.drawBuildPreview();
    }).catch(err => this.reportOrderError(err));
  }

  private selectShips(ids: readonly bigint[]): void {
    this.selectedBuildingId = null;
    this.buildingSelectionGraphics?.clear();
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
      this.selectedBuildingId = id;
      this.drawBuildingHighlight();
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
        // A placed Shipyard/Workshop/Rig/Cannon is ready to be inspected.
        // Keep rapid repeated Platform placement, but release single-building
        // tools automatically so the next click selects the finished building.
        if (kind !== "platform" && this.buildKind === kind) this.cancelBuilding();
        else this.drawBuildPreview();
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

      // Mounted structures *overlap* their supporting Platforms. Never
      // choose a submerged deck before its Shipyard/Workshop/Rig/Cannon.
      // Enemy structures are inspectable, but their private queues are not.
      const chosen = selectStructureAt(x, y, state.battleStructures);
      if (chosen) {
        this.selectEntity("structure", chosen.id);
        return;
      }
      // Left-click empty sea or drag an empty box: clear the prior selection.
      this.selectShips([]);
      return;
    }

    if (button === 2) {
      const command = resolveRightClickCommand(
        { x, y }, state.myMembership?.slot,
        state.battleShips, state.battleStructures, state.salvageNodes,
      );
      if (command.kind === "attack") {
        if (!this.selectedShipIds.size) {
          this.reportOrderError("Select at least one ship before attacking");
          return;
        }
        this.issueAttackOrders([...this.selectedShipIds], command);
        return;
      }
      if (command.kind === "salvage" && this.selectedShipId !== null) {
        const ship = state.myShips.find(s => s.id === this.selectedShipId);
        if (ship) {
          if (Math.hypot(ship.x - command.gridX - 0.5, ship.y - command.gridY - 0.5) <= 3.5) {
            spacetimeClient.orderHarvest(ship.id, command.nodeId)
              .catch(err => this.reportOrderError(err));
          } else {
            spacetimeClient.issueShipOrder(
              ship.id, command.gridX + 0.5, command.gridY + 0.5,
            ).catch(err => this.reportOrderError(err));
          }
        }
        return;
      }
      if (!this.selectedShipIds.size) return;
      // Box-selected fleets receive independent authoritative move orders.
      // Give each vessel a small formation offset, rather than stacking every
      // collision hull onto precisely the same endpoint.
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

  /** One persistent Attack Target order per selected owned ship. */
  private issueAttackOrders(
    shipIds: readonly bigint[],
    command: Extract<RightClickCommand, { kind: "attack" }>,
  ): void {
    this.drawAttackMarker(command.x, command.y);
    void Promise.allSettled(shipIds.map(shipId =>
      spacetimeClient.issueAttackOrder(
        shipId, command.targetType, command.targetId,
      ),
    )).then(results => {
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) {
        const first = failures[0] as PromiseRejectedResult;
        this.reportOrderError(
          failures.length === shipIds.length
            ? (first.reason instanceof Error ? first.reason.message : "Attack order rejected")
            : `${failures.length} of ${shipIds.length} attack orders were rejected`,
        );
        return;
      }
      window.dispatchEvent(new CustomEvent(GEMINI_FEEDBACK_EVENT, {
        detail: {
          message: `${shipIds.length === 1 ? "Ship" : `${shipIds.length} ships`} attacking ${command.targetType}`,
          success: true,
        },
      }));
    });
  }

  private drawAttackMarker(x: number, y: number): void {
    this.markers.clear();
    this.markers.lineStyle(2, 0xf87171, 0.95);
    this.markers.strokeCircle(x * TILE, y * TILE, 16);
    this.markers.lineBetween(x * TILE - 22, y * TILE, x * TILE - 10, y * TILE);
    this.markers.lineBetween(x * TILE + 10, y * TILE, x * TILE + 22, y * TILE);
    this.markers.lineBetween(x * TILE, y * TILE - 22, x * TILE, y * TILE - 10);
    this.markers.lineBetween(x * TILE, y * TILE + 10, x * TILE, y * TILE + 22);
    this.time.delayedCall(900, () => this.markers.clear());
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
    this.syncAttackOrders(state);
    this.syncProjectiles(state);
    this.syncImpacts(state);
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
    // The sea is visually endless even though the authoritative playable
    // world (terrain, bases and legal command targets) is finite.
    // Camera bounds would create an apparent sea "edge" on wide screens.
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
    for (const node of spacetimeClient.getState().materialDeposits) {
      const px = node.gridX * TILE, py = node.gridY * TILE;
      const palette = RESOURCE_TYPES[node.kind as AdvancedResourceKind];
      const tint = Number.parseInt((palette?.color ?? "#f8fafc").slice(1), 16);
      const hasMaterial = node.remaining > 0;
      gfx.lineStyle(2, tint, hasMaterial ? 0.85 : 0.25);
      gfx.strokeCircle(px + TILE / 2, py + TILE / 2, 12);
      gfx.fillStyle(hasMaterial ? tint : 0x334155, hasMaterial ? 0.8 : 0.5);
      gfx.fillRect(px + 14, py + 14, 12, 12);
      gfx.lineStyle(1, 0x020617, 0.65);
      gfx.strokeRect(px + 14, py + 14, 12, 12);
    }
  }

  private syncBuildings(buildings: readonly GeminiBattleStructure[]): void {
    const alive = new Set(buildings.map(st => st.id));
    for (const [id, art] of this.buildings) {
      if (!alive.has(id)) {
        this.spawnEffect(
          "explosion",
          art.image.x + art.image.displayWidth / 2,
          art.image.y + art.image.displayHeight / 2,
          620,
        );
        art.image.destroy();
        this.buildings.delete(id);
      }
    }
    if (this.selectedBuildingId !== null && !alive.has(this.selectedBuildingId)) {
      this.selectEntity(null);
    }
    for (const st of buildings) {
      const key = geminiStructureTexture(this, st.kind, st.ownerSlot, st.connected, st.complete);
      let art = this.buildings.get(st.id);
      if (!art) {
        const image = this.add.image(st.gridX * TILE, st.gridY * TILE, key)
          .setOrigin(0, 0).setDepth(10);
        art = { image, key, hp: st.hp };
        this.buildings.set(st.id, art);
      } else {
        if (art.key !== key) { art.image.setTexture(key); art.key = key; }
        if (st.hp < art.hp) {
          this.spawnEffect(
            "hit",
            (st.gridX + st.width / 2) * TILE,
            (st.gridY + st.height / 2) * TILE,
            260,
          );
        }
        art.hp = st.hp;
        art.image.setPosition(st.gridX * TILE, st.gridY * TILE);
      }
    }
    this.drawBuildingHighlight();
  }

  private drawBuildingHighlight(): void {
    const gfx = this.buildingSelectionGraphics;
    if (!gfx) return;
    gfx.clear();
    if (this.selectedBuildingId === null) return;
    const building = spacetimeClient.getState().battleStructures.find(
      st => st.id === this.selectedBuildingId,
    );
    if (!building) return;
    const own = building.ownerSlot === spacetimeClient.getState().myMembership?.slot;
    const color = own ? 0x67e8f9 : 0xf87171;
    gfx.lineStyle(3, color, 0.95);
    gfx.strokeRect(
      building.gridX * TILE - 2, building.gridY * TILE - 2,
      building.width * TILE + 4, building.height * TILE + 4,
    );
    if (building.kind === "salvage_rig") {
      gfx.lineStyle(2, 0x34d399, 0.65);
      gfx.strokeCircle(
        (building.gridX + building.width / 2) * TILE,
        (building.gridY + building.height / 2) * TILE,
        ECONOMY_RULES.rigRangeCells * TILE,
      );
    }
  }

  private syncShips(ships: readonly GeminiBattleShip[]): void {
    const alive = new Set(ships.map(ship => ship.id));
    let selectionChanged = false;
    for (const [id, art] of this.vessels) {
      if (!alive.has(id)) {
        this.spawnEffect("explosion", art.container.x, art.container.y, 620);
        art.motion.clear();
        art.container.destroy();
        this.vessels.delete(id);
        if (this.selectedShipIds.delete(id)) selectionChanged = true;
      }
    }
    if (selectionChanged) this.selectShips([...this.selectedShipIds]);
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
          lastSnapshot: null, kind: "", slot: -1, hp: ship.hp,
        };
        this.vessels.set(ship.id, art);
      }
      if (art.kind !== ship.kind || art.slot !== ship.ownerSlot) {
        art.kind = ship.kind;
        art.slot = ship.ownerSlot;
        this.drawVessel(art, ship);
      }
      if (ship.hp < art.hp) {
        this.spawnEffect("hit", art.container.x, art.container.y, 240);
      }
      art.hp = ship.hp;
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

  private syncAttackOrders(state: SpacetimeClientState): void {
    this.attackTargets.clear();
    for (const order of state.attackOrders) {
      this.attackTargets.set(order.shipId, {
        targetType: order.targetType, targetId: order.targetId,
      });
    }
  }

  /**
   * Authoritative projectile rows arrive at the 10Hz combat cadence. The client
   * only interpolates their presentation; damage still resolves server-side.
   */
  private syncProjectiles(state: SpacetimeClientState): void {
    const seen = new Set<bigint>();
    for (const row of state.battleProjectiles) {
      seen.add(row.id);
      const existing = this.projectiles.get(row.id);
      if (existing) {
        // Preserve the timestamp if this subscription pass contains no new
        // authoritative motion row (unrelated HUD updates are frequent).
        if (existing.serverX !== row.x || existing.serverY !== row.y) {
          existing.serverX = row.x;
          existing.serverY = row.y;
          existing.observedAtMs = Date.now();
        }
        existing.vx = row.vx;
        existing.vy = row.vy;
        continue;
      }
      const muzzle = row.sourceType === "ship"
        ? this.vessels.get(row.sourceId)?.container
        : undefined;
      const building = row.sourceType === "structure"
        ? this.buildings.get(row.sourceId)?.image : undefined;
      if (muzzle) this.spawnEffect("muzzle", muzzle.x, muzzle.y, 130);
      else if (building) this.spawnEffect(
        "muzzle",
        building.x + building.displayWidth / 2,
        building.y + building.displayHeight / 2, 130,
      );
      this.projectiles.set(row.id, {
        displayX: row.x, displayY: row.y,
        serverX: row.x, serverY: row.y,
        vx: row.vx, vy: row.vy, observedAtMs: Date.now(),
        sourceFaction: row.sourceFaction,
      });
    }
    for (const id of this.projectiles.keys()) {
      if (!seen.has(id)) this.projectiles.delete(id);
    }
  }

  private syncImpacts(state: SpacetimeClientState): void {
    const live = new Set<bigint>();
    for (const impact of state.battleImpacts) {
      live.add(impact.id);
      if (this.seenImpactIds.has(impact.id)) continue;
      this.seenImpactIds.add(impact.id);
      // Effects are ONLY drawn at the true authoritative swept-collision
      // or maximum-flight endpoint, not a stale, lagging client sprite.
      this.projectiles.delete(impact.projectileId);
      this.spawnEffect(
        impact.kind === "hit" ? "hit" : "splash",
        impact.x * TILE, impact.y * TILE,
        impact.kind === "hit" ? 330 : 360,
      );
    }
    for (const id of this.seenImpactIds) {
      if (!live.has(id)) this.seenImpactIds.delete(id);
    }
  }

  private spawnEffect(
    kind: CombatEffect["kind"], x: number, y: number, duration: number,
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.effects.length > 120) this.effects.shift();
    this.effects.push({ kind, x, y, age: 0, duration });
  }

  private drawCombatOverlay(state: SpacetimeClientState): void {
    const gfx = this.combatGraphics;
    if (!gfx) return;
    gfx.clear();
    const ownSlot = state.myMembership?.slot;

    for (const [shipId, order] of this.attackTargets) {
      const own = this.vessels.get(shipId)?.container;
      if (!own) continue;
      const target = order.targetType === "ship"
        ? state.battleShips.find(ship => ship.id === order.targetId)
        : state.battleStructures.find(st => st.id === order.targetId);
      if (!target) continue;
      const tx = "gridX" in target
        ? (target.gridX + target.width / 2) * TILE
        : target.x * TILE;
      const ty = "gridY" in target
        ? (target.gridY + target.height / 2) * TILE
        : target.y * TILE;
      gfx.lineStyle(1, 0xf87171, 0.55);
      gfx.lineBetween(own.x, own.y, tx, ty);
      gfx.lineStyle(2, 0xf87171, 0.9);
      gfx.strokeCircle(tx, ty, "gridX" in target
        ? Math.max(target.width, target.height) * TILE * 0.62 : 16);
      gfx.lineBetween(tx - 4, ty, tx + 4, ty);
      gfx.lineBetween(tx, ty - 4, tx, ty + 4);
    }

    // HP bars remain presentation-only and disappear at full health.
    for (const ship of state.battleShips) {
      const maxHp = ECONOMY_RULES.ships[ship.kind as keyof typeof ECONOMY_RULES.ships]?.hp;
      if (!maxHp || ship.hp >= maxHp) continue;
      const art = this.vessels.get(ship.id);
      if (!art) continue;
      this.drawHealthBar(
        art.container.x, art.container.y - (ship.radiusCells * TILE + 14),
        30, 4, ship.hp / maxHp, ship.ownerSlot === ownSlot,
      );
    }
    for (const st of state.battleStructures) {
      const maxHp = structureDefinition(st.kind)?.hp;
      if (!maxHp || st.hp >= maxHp) continue;
      const art = this.buildings.get(st.id);
      if (!art) continue;
      this.drawHealthBar(
        art.image.x + art.image.displayWidth / 2,
        art.image.y - 8,
        Math.max(26, art.image.displayWidth - 8), 4, st.hp / maxHp,
        st.ownerSlot === ownSlot,
      );
    }
  }

  private drawHealthBar(
    x: number, y: number, width: number, height: number,
    fraction: number, own: boolean,
  ): void {
    const gfx = this.combatGraphics;
    const clamped = Math.max(0, Math.min(1, fraction));
    const color = clamped > 0.55 ? 0x4ade80 : clamped > 0.25 ? 0xfacc15 : 0xf87171;
    gfx.fillStyle(0x020617, 0.85);
    gfx.fillRect(x - width / 2 - 1, y - 1, width + 2, height + 2);
    gfx.fillStyle(color, 1);
    gfx.fillRect(x - width / 2, y, width * clamped, height);
    if (own) {
      gfx.lineStyle(1, 0x67e8f9, 0.7);
      gfx.strokeRect(x - width / 2 - 1, y - 1, width + 2, height + 2);
    }
  }

  private drawProjectiles(delta: number): void {
    const gfx = this.projectileGraphics;
    if (!gfx) return;
    gfx.clear();
    const t = Math.min(1, delta / 35);
    const now = Date.now();
    for (const art of this.projectiles.values()) {
      // Advance the observed launch velocity between 10Hz server updates.
      // A short cap prevents runaway predictions across network stalls.
      const elapsed = Math.max(0, Math.min(0.12, (now - art.observedAtMs) / 1000));
      const targetX = art.serverX + art.vx * elapsed;
      const targetY = art.serverY + art.vy * elapsed;
      art.displayX += (targetX - art.displayX) * t;
      art.displayY += (targetY - art.displayY) * t;
      const x = art.displayX * TILE, y = art.displayY * TILE;
      const length = Math.hypot(art.vx, art.vy) || 1;
      const dx = art.vx / length, dy = art.vy / length;
      const tint = Number.parseInt(geminiFactionColor(art.sourceFaction).slice(1), 16);
      gfx.lineStyle(2, tint, 0.7);
      gfx.lineBetween(x - dx * 10, y - dy * 10, x, y);
      gfx.fillStyle(0xfef3c7, 0.98);
      gfx.fillCircle(x, y, 2.4);
      gfx.fillStyle(tint, 0.5);
      gfx.fillCircle(x, y, 4);
    }
  }

  private drawEffects(delta: number): void {
    const gfx = this.effectsGraphics;
    if (!gfx) return;
    gfx.clear();
    if (!this.effects.length) return;
    this.effects = this.effects.filter(effect => {
      effect.age += delta;
      return effect.age < effect.duration;
    });
    for (const effect of this.effects) {
      const progress = effect.age / effect.duration;
      if (effect.kind === "muzzle") {
        gfx.fillStyle(0xfef08a, 1 - progress);
        gfx.fillCircle(effect.x, effect.y, 4 + progress * 10);
        gfx.fillStyle(0xfef3c7, (1 - progress) * 0.8);
        gfx.fillCircle(effect.x, effect.y, 2 + progress * 3);
      } else if (effect.kind === "splash") {
        gfx.lineStyle(2, 0x93c5fd, 1 - progress);
        gfx.strokeCircle(effect.x, effect.y, 4 + progress * 16);
        gfx.fillStyle(0xbae6fd, (1 - progress) * 0.8);
        gfx.fillCircle(effect.x, effect.y, 2.5);
      } else if (effect.kind === "hit") {
        gfx.fillStyle(0xfca5a5, 1 - progress);
        gfx.fillCircle(effect.x, effect.y, 3 + progress * 7);
        gfx.fillStyle(0xfff7ed, (1 - progress) * 0.9);
        gfx.fillCircle(effect.x, effect.y, 1.5 + progress * 2);
      } else {
        gfx.lineStyle(3, 0xf97316, 1 - progress);
        gfx.strokeCircle(effect.x, effect.y, 8 + progress * 34);
        gfx.fillStyle(0xfde68a, (1 - progress) * 0.9);
        gfx.fillCircle(effect.x, effect.y, 8 + progress * 10);
        gfx.fillStyle(0xf97316, (1 - progress) * 0.5);
        gfx.fillCircle(effect.x, effect.y, 14 + progress * 16);
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
    this.drawCombatOverlay(state);
    this.drawProjectiles(delta);
    this.drawEffects(delta);
  }

  private redrawOcean(): void {
    if (!this.ocean) return;
    // Infinite *visual* ocean. The server map remains finite for commands;
    // water extends beyond its edges wherever the camera can see.
    const camera = this.cameras.main;
    // Phaser camera scrollX/scrollY alone are NOT the actual top-left world
    // corner when zoom is != 1 (or when zooming around the center). Earlier
    // calculations created a visible rectangular gap on wide viewports.
    // Unproject all viewport corners using the live camera matrix instead.
    const a = camera.getWorldPoint(0, 0);
    const b = camera.getWorldPoint(camera.width, 0);
    const d = camera.getWorldPoint(0, camera.height);
    const e = camera.getWorldPoint(camera.width, camera.height);
    const minX = Math.min(a.x, b.x, d.x, e.x);
    const maxX = Math.max(a.x, b.x, d.x, e.x);
    const minY = Math.min(a.y, b.y, d.y, e.y);
    const maxY = Math.max(a.y, b.y, d.y, e.y);
    const startX = Math.floor(minX / TILE) - 4;
    const startY = Math.floor(minY / TILE) - 4;
    const endX = Math.ceil(maxX / TILE) + 4;
    const endY = Math.ceil(maxY / TILE) + 4;
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
      // Every visible cell receives water, including cells that have no
      // authoritative terrain tile beyond the finite playable map. Otherwise
      // the unshaded dark background reads as a hard rectangular ocean edge.
      this.ocean.fillStyle(
        v > 0.55 ? 0x10334b : v > -0.15 ? 0x0b263b : 0x081e30,
        1,
      );
      this.ocean.fillRect(x, y, TILE, TILE);
      if (v > 0.78) {
        this.ocean.fillStyle(0x94d2e8, 0.18);
        this.ocean.fillRect(x + 6, y + 14, 14, 3);
      }
      this.ocean.lineStyle(1, 0x38bdf8, 0.045);
      this.ocean.strokeRect(x, y, TILE, TILE);
    }
  }
}
