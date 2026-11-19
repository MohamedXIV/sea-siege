/**
 * Sea Siege's typed resource vocabulary. "Iron" is the player's name for
 * existing, server-authoritative legacy Salvage during the safe migration.
 * Oil, alloy and isotopes have their own ledgers and physical deposits.
 *
 * No new material is allowed to silently bypass the current salvage debit.
 */
export const RESOURCE_TYPES = {
  iron: { name: "Iron Scrap", color: "#cbd5e1", rarity: "common" },
  oil: { name: "Recovered Oil", color: "#fb923c", rarity: "uncommon" },
  alloy: { name: "Pre-Collapse Alloys", color: "#facc15", rarity: "rare" },
  isotope: { name: "Radioisotopes", color: "#86efac", rarity: "very_rare" },
} as const;
export type ResourceKind = keyof typeof RESOURCE_TYPES;
export type AdvancedResourceKind = Exclude<ResourceKind, "iron">;
export const materialBalanceKey = (matchId: bigint, slot: number, kind: AdvancedResourceKind): string =>
  `${matchId.toString()}:${slot}:${kind}`;
export const ADVANCED_RESOURCE_KINDS = ["oil", "alloy", "isotope"] as const;

export type ResourceWallet = Readonly<Record<ResourceKind, number>>;
export type ResourceCost = Partial<Record<ResourceKind, number>>;
export const MAX_MATERIAL_BALANCE = 0xffff_ffff;

/** Prices are data, not a collection of hard-coded UI or reducer branches. */
export const RESOURCE_RECIPES = {
  platform: { iron: 25 },
  workshop: { iron: 120 },
  shipyard: { iron: 150 },
  cannon: { iron: 95 },
  salvage_rig: { iron: 110 },
  scout: { iron: 70 },
  gunboat: { iron: 130 },
  siege: { iron: 220 },

  // Proposed advanced *options*, not automatic replacements for base hulls.
  // Runtime entitlement/upgrade reducers will be implemented in a separate
  // coherent vertical slice after recipe UX and bot policy review.
  reinforced_hull: { iron: 60, alloy: 35 },
  high_output_engine: { iron: 75, oil: 45 },
  radiothermal_power: { iron: 90, oil: 50, isotope: 10 },
} as const satisfies Record<string, ResourceCost>;
export type RecipeKey = keyof typeof RESOURCE_RECIPES;

function validAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_MATERIAL_BALANCE;
}

export function emptyWallet(iron = 0): ResourceWallet {
  if (!validAmount(iron)) throw new RangeError("Invalid starting iron");
  return { iron, oil: 0, alloy: 0, isotope: 0 };
}

export function creditResource(
  wallet: ResourceWallet, kind: ResourceKind, amount: number,
): ResourceWallet {
  if (!validAmount(amount) || !validAmount(wallet[kind]))
    throw new RangeError("Invalid material credit");
  return { ...wallet, [kind]: Math.min(MAX_MATERIAL_BALANCE, wallet[kind] + amount) };
}

export function canAffordResources(wallet: ResourceWallet, cost: ResourceCost): boolean {
  return (Object.keys(RESOURCE_TYPES) as ResourceKind[])
    .every(kind => validAmount(wallet[kind]) &&
      validAmount(cost[kind] ?? 0) &&
      wallet[kind] >= (cost[kind] ?? 0));
}

/** Pure all-or-nothing debit: never mutate the source wallet on failure. */
export function debitResources(wallet: ResourceWallet, cost: ResourceCost): ResourceWallet {
  if (!canAffordResources(wallet, cost)) throw new Error("Insufficient resources");
  return (Object.keys(RESOURCE_TYPES) as ResourceKind[]).reduce(
    (remaining, kind) => ({
      ...remaining, [kind]: remaining[kind] - (cost[kind] ?? 0),
    }), { ...wallet },
  );
}

export type ExtractionSource = Readonly<{
  id: bigint;
  kind: AdvancedResourceKind;
  remaining: number;
}>;

/**
 * Allocate a single bounded extractor/ship budget deterministically across
 * several live deposits. Callers write all deductions in one DB transaction.
 * No deposit is ever overdrawn, and unused capacity is not invented.
 */
export function allocateResourceDraws(
  sources: readonly ExtractionSource[], maxTotal: number,
  maxPerNode = maxTotal,
): ReadonlyArray<{ id: bigint; kind: AdvancedResourceKind; taken: number }> {
  if (!validAmount(maxTotal) || !validAmount(maxPerNode))
    throw new RangeError("Invalid extraction budget");
  let left = maxTotal;
  const out: Array<{ id: bigint; kind: AdvancedResourceKind; taken: number }> = [];
  for (const source of [...sources].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (!validAmount(source.remaining)) throw new RangeError("Invalid deposit");
    const taken = Math.min(left, maxPerNode, source.remaining);
    if (taken) out.push({ id: source.id, kind: source.kind, taken });
    left -= taken;
    if (!left) break;
  }
  return out;
}
