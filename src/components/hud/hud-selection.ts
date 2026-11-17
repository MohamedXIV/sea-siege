import type { SpacetimeClientState } from "@/network/spacetime-client";

export type HudSelection =
  | { type: "ship"; id: bigint; shipIds?: bigint[] }
  | { type: "structure"; id: bigint }
  | null;

function displayKind(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Resolve selection against current authorized rows, not an event's old snapshot. */
export function getHudSelectionLabel(selection: HudSelection, state: SpacetimeClientState): string {
  if (state.status !== "connected" || state.subscriptionStatus !== "applied") return "No selection";
  if (selection?.type === "ship") {
    const ids = new Set(selection.shipIds ?? [selection.id]);
    const ships = state.myShips.filter(ship => ids.has(ship.id));
    if (ships.length > 1) return `${ships.length} ships selected`;
    if (ships.length === 1) return `${displayKind(ships[0].kind)} selected · HP ${ships[0].hp}`;
  }

  if (selection?.type === "structure") {
    const building = state.battleStructures.find(row => row.id === selection.id);
    if (building) {
      const owner = building.ownerSlot === state.myMembership?.slot ? "" : "Enemy ";
      return `${owner}${displayKind(building.kind)} selected · HP ${building.hp}`;
    }
  }

  return "No selection";
}
