import {
  RESOURCE_RECIPES, canAffordResources, debitResources,
  type ResourceWallet,
} from "./materials.ts";

/**
 * First optional ship specializations. Basic hulls stay purchasable with Iron
 * alone; advanced materials give meaningful *alternatives*, not mandatory
 * tech tiers or a replacement for the real movement/combat simulation.
 */
export const SHIP_REFIT_RULES = {
  reinforced_hull: {
    label: "Reinforced Hull",
    bonusHp: 120,
    speedMultiplier: 1,
    cost: RESOURCE_RECIPES.reinforced_hull,
  },
  high_output_engine: {
    label: "High-Output Engine",
    bonusHp: 0,
    speedMultiplier: 1.2,
    cost: RESOURCE_RECIPES.high_output_engine,
  },
} as const;

export type ShipRefitKind = keyof typeof SHIP_REFIT_RULES;
export type ShipRefitState = Readonly<{
  reinforcedHull: boolean;
  highOutputEngine: boolean;
}>;

export const NO_SHIP_REFITS: ShipRefitState = {
  reinforcedHull: false,
  highOutputEngine: false,
};

export function validShipRefitKind(kind: string): kind is ShipRefitKind {
  return Object.prototype.hasOwnProperty.call(SHIP_REFIT_RULES, kind);
}

export function alreadyInstalled(state: ShipRefitState, kind: ShipRefitKind): boolean {
  return kind === "reinforced_hull" ? state.reinforcedHull : state.highOutputEngine;
}

export function applyShipRefit(state: ShipRefitState, kind: ShipRefitKind): ShipRefitState {
  if (alreadyInstalled(state, kind)) throw new Error("Ship already has this refit");
  return kind === "reinforced_hull"
    ? { ...state, reinforcedHull: true }
    : { ...state, highOutputEngine: true };
}

/** Refit is all-or-nothing, including both Iron and the advanced material. */
export function purchaseShipRefit(
  wallet: ResourceWallet, state: ShipRefitState, kind: ShipRefitKind,
): Readonly<{ wallet: ResourceWallet; state: ShipRefitState; hpBonus: number }> {
  if (alreadyInstalled(state, kind)) throw new Error("Ship already has this refit");
  const rule = SHIP_REFIT_RULES[kind];
  if (!canAffordResources(wallet, rule.cost)) throw new Error("Insufficient refit resources");
  return {
    wallet: debitResources(wallet, rule.cost),
    state: applyShipRefit(state, kind),
    hpBonus: rule.bonusHp,
  };
}

export function refitMaximumShipHp(baseHp: number, state: ShipRefitState): number {
  if (!Number.isSafeInteger(baseHp) || baseHp <= 0) throw new RangeError("Invalid ship HP");
  return baseHp + (state.reinforcedHull ? SHIP_REFIT_RULES.reinforced_hull.bonusHp : 0);
}

export function shipSpeedMultiplier(state: ShipRefitState): number {
  return state.highOutputEngine ? SHIP_REFIT_RULES.high_output_engine.speedMultiplier : 1;
}
