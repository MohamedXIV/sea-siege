import { CONSTRUCTION_RULES, type StructureKind } from "../../../spacetimedb/src/sim/construction";

/** Player-facing building descriptions; server remains source of truth for rules. */
export const BUILDING_INFO = {
  command_core: {
    name: "Command Core",
    role: "Fleet headquarters",
    description: "Your headquarters anchors the connected platform network. Losing it can eliminate your faction.",
  },
  platform: {
    name: "Floating Platform",
    role: "Territory & construction support",
    description: "Expands connected territory over the ocean. Workshops, Shipyards, Extractors and Cannons need completed supporting platforms.",
  },
  shipyard: {
    name: "Shipyard",
    role: "Military ship production",
    description: "Queues Scouts, Gunboats and Siege Monitors one at a time. Requires completed connected platforms and clear nearby water to launch.",
  },
  workshop: {
    name: "Workshop",
    role: "Repairs, upgrades & ship refits",
    description: "Repairs nearby allied ships and structures, upgrades its service radius and equips advanced Oil/Alloy ship refits.",
  },
  cannon: {
    name: "Defense Cannon",
    role: "Fixed coastal artillery",
    description: "Defensive gun protecting your platform network. Must remain complete and connected to operate.",
  },
  salvage_rig: {
    name: "Salvage Extractor",
    role: "Automatic resource gathering",
    description: "Automatically collects materials from deposits within its extraction radius while complete and connected.",
  },
} as const satisfies Record<StructureKind, {
  name: string; role: string; description: string;
}>;

export function buildingInfo(kind: string) {
  return Object.prototype.hasOwnProperty.call(BUILDING_INFO, kind)
    ? BUILDING_INFO[kind as StructureKind]
    : { name: "Unknown Structure", role: "Unidentified", description: "No building description available." };
}

export function buildingMaxHp(kind: string): number | null {
  return CONSTRUCTION_RULES.definitions[kind as StructureKind]?.hp ?? null;
}
