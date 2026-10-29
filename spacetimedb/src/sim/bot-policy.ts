/**
 * Pure strategic policy for server-owned Sea Siege factions.
 * The observation is an explicit, visibility-filtered capability: this file
 * must NEVER import database tables, full world chunks or hidden enemy rows.
 * An authoritative adapter must revalidate EVERY returned intent before use.
 */
import { ECONOMY_RULES, type ShipKind } from './economy.ts';
import { COMBAT_RULES, type WeaponKind } from './combat.ts';
import { desiredBearing, turretAligned } from './turret-aim.ts';

export const BOT_RULES = {
  maxIntelAgeUs: 2_000_000n,
  difficulties: {
    easy:   { intervalUs: 4_000_000n, maxOrders: 1, defenseRangeScale: 0.8, queueLimit: 1, aggression: 0 },
    normal: { intervalUs: 2_000_000n, maxOrders: 2, defenseRangeScale: 1.0, queueLimit: 2, aggression: 1 },
    hard:   { intervalUs: 1_000_000n, maxOrders: 3, defenseRangeScale: 1.0, queueLimit: 3, aggression: 2 },
  },
} as const;
export type BotDifficulty = keyof typeof BOT_RULES.difficulties;
export type Position = Readonly<{ x: number; y: number }>;
export type BotShip = Readonly<{ id: bigint; kind: ShipKind; position: Position;
  hp: number; turretAngleDeg: number; busy: boolean }>;
export type BotStructure = Readonly<{ id: bigint; kind: string; position: Position;
  complete: boolean; connected: boolean; queueLength: number }>;
export type VisibleEnemy = Readonly<{ id: bigint; entityType: 'ship' | 'structure';
  position: Position; observedAtUs: bigint }>;
export type KnownDeposit = Readonly<{ id: bigint; position: Position; remaining: number }>;
export type LegalBuildCandidate = Readonly<{ kind: 'platform' | 'shipyard' | 'salvage_rig' | 'cannon';
  gridX: number; gridY: number }>;
export type BotObservation = Readonly<{
  slot: number;
  seed: number;
  nowUs: bigint;
  salvage: number;
  ships: readonly BotShip[];
  structures: readonly BotStructure[];
  /** ONLY actively detected enemies, not full hidden-world state. */
  visibleEnemies: readonly VisibleEnemy[];
  /** ONLY discovered resource nodes, not all deposits in the database. */
  knownDeposits: readonly KnownDeposit[];
  /** ONLY legal candidates generated from server-authorized local knowledge. */
  legalBuildCandidates: readonly LegalBuildCandidate[];
  /** Explorable frontier centers, never secret enemy positions. */
  explorationFrontiers: readonly Position[];
}>;
export type BotIntent =
  | Readonly<{ type: 'aim'; shipId: bigint; angleDeg: number }>
  | Readonly<{ type: 'fire'; shipId: bigint; targetType: 'ship' | 'structure'; targetId: bigint }>
  | Readonly<{ type: 'harvest'; shipId: bigint; nodeId: bigint }>
  | Readonly<{ type: 'move'; shipId: bigint; destination: Position }>
  | Readonly<{ type: 'build'; kind: LegalBuildCandidate['kind']; gridX: number; gridY: number }>
  | Readonly<{ type: 'enqueue'; yardId: bigint; shipKind: ShipKind }>;
export type BotDecision = Readonly<{ intents: readonly BotIntent[]; nextDecisionUs: bigint }>;

const sortBigint = (a: bigint, b: bigint): number => a < b ? -1 : a > b ? 1 : 0;
const distance = (a: Position, b: Position): number => Math.hypot(a.x - b.x, a.y - b.y);
const validPosition = (p: Position): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
function stablePick(seed: number, slot: number, epoch: bigint, count: number): number {
  // FNV-1a over deterministic, low-bandwidth input; no nondeterministic clock/RNG.
  let h = 2166136261 >>> 0;
  const input = String(seed) + ':' + String(slot) + ':' + epoch.toString();
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619) >>> 0;
  return h % count;
}
function validateObservation(obs: BotObservation): void {
  if (!Number.isInteger(obs.slot) || obs.slot < 0 || !Number.isInteger(obs.seed) ||
      obs.seed < 0 || obs.seed > 0xffffffff || obs.nowUs < 0n ||
      !Number.isSafeInteger(obs.salvage) || obs.salvage < 0 ||
      !obs.ships.every(s => s.hp > 0 && Number.isFinite(s.turretAngleDeg) && validPosition(s.position)) ||
      !obs.structures.every(s => validPosition(s.position) && Number.isSafeInteger(s.queueLength) && s.queueLength >= 0) ||
      !obs.visibleEnemies.every(e => validPosition(e.position) && e.observedAtUs <= obs.nowUs) ||
      !obs.knownDeposits.every(n => validPosition(n.position) && Number.isSafeInteger(n.remaining) && n.remaining >= 0) ||
      !obs.explorationFrontiers.every(validPosition)) {
    throw new RangeError('Invalid bot observation');
  }
}

/**
 * At most difficulty.maxOrders per strategic interval; no hidden-state reads,
 * extra sockets, client commands or grants of resources. This policy can
 * propose an intent, but ONLY the server's existing rule validators may apply it.
 */
export function decideBot(obs: BotObservation, difficulty: BotDifficulty): BotDecision {
  const rule = BOT_RULES.difficulties[difficulty];
  if (!rule) throw new RangeError('Invalid bot difficulty');
  validateObservation(obs);
  const epoch = obs.nowUs / rule.intervalUs;
  const intents: BotIntent[] = [];
  let reservedSalvage = 0;
  const usedShips = new Set<bigint>();
  const occupiedTargets = new Set<bigint>();
  const ships = [...obs.ships].sort((a, b) => sortBigint(a.id, b.id));
  const liveEnemies = obs.visibleEnemies.filter(e =>
    obs.nowUs - e.observedAtUs <= BOT_RULES.maxIntelAgeUs,
  ).sort((a, b) => sortBigint(a.id, b.id));
  const deposits = obs.knownDeposits.filter(n => n.remaining > 0)
    .sort((a, b) => sortBigint(a.id, b.id));
  const yards = obs.structures.filter(s => s.kind === 'shipyard' && s.complete && s.connected)
    .sort((a, b) => sortBigint(a.id, b.id));
  const canAdd = (): boolean => intents.length < rule.maxOrders;
  const emit = (intent: BotIntent, shipId?: bigint): void => {
    if (!canAdd()) return;
    intents.push(intent);
    if (shipId !== undefined) usedShips.add(shipId);
  };

  // Defense/attack actions: only observable hostiles, never global enemy rows.
  for (const ship of ships) {
    if (!canAdd()) break;
    const weapon = COMBAT_RULES.weapons[ship.kind as WeaponKind];
    if (!weapon) continue;
    const target = liveEnemies.filter(e => distance(ship.position, e.position) <=
      Math.min(weapon.range, weapon.vision) * rule.defenseRangeScale)
      .sort((a, b) => distance(ship.position, a.position) - distance(ship.position, b.position) ||
        sortBigint(a.id, b.id))[0];
    if (!target) continue;
    const desired = desiredBearing(ship.position, target.position);
    if (!turretAligned(ship.turretAngleDeg, desired)) {
      emit({ type: 'aim', shipId: ship.id, angleDeg: desired }, ship.id);
    } else if (!occupiedTargets.has(target.id)) {
      emit({ type: 'fire', shipId: ship.id, targetType: target.entityType, targetId: target.id }, ship.id);
      occupiedTargets.add(target.id);
    }
  }

  // Harvest opportunities use discovered nodes only and cannot create resources.
  for (const ship of ships) {
    if (!canAdd()) break;
    if (usedShips.has(ship.id) || ship.busy || ECONOMY_RULES.ships[ship.kind].harvestPerSecond === 0) continue;
    const nearest = deposits.slice().sort((a, b) =>
      distance(ship.position, a.position) - distance(ship.position, b.position) || sortBigint(a.id, b.id))[0];
    if (!nearest) continue;
    if (distance(ship.position, nearest.position) <= ECONOMY_RULES.harvestRangeCells) {
      emit({ type: 'harvest', shipId: ship.id, nodeId: nearest.id }, ship.id);
    } else {
      emit({ type: 'move', shipId: ship.id, destination: nearest.position }, ship.id);
    }
  }

  // Server-validated construction candidates only: no free-build AI cheats.
  const connected = obs.structures.filter(s => s.complete && s.connected);
  const shipyards = connected.filter(s => s.kind === 'shipyard');
  const rigs = connected.filter(s => s.kind === 'salvage_rig');
  const preference: LegalBuildCandidate['kind'][] =
    shipyards.length === 0 ? ['shipyard', 'platform'] :
    rigs.length === 0 ? ['salvage_rig', 'platform', 'cannon'] : ['cannon', 'platform'];
  for (const kind of preference) {
    if (!canAdd()) break;
    const cost = kind === 'platform' ? 25 : kind === 'shipyard' ? 150 : kind === 'salvage_rig' ? 110 : 95;
    if (obs.salvage - reservedSalvage < cost) continue;
    const candidates = obs.legalBuildCandidates.filter(c => c.kind === kind)
      .sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
    if (candidates.length) {
      const candidate = candidates[stablePick(obs.seed, obs.slot, epoch, candidates.length)]!;
      emit({ type: 'build', kind, gridX: candidate.gridX, gridY: candidate.gridY });
      reservedSalvage += cost;
      break;
    }
  }

  // Queue only existing operational shipyards; pricing must be rechecked by DB.
  for (const yard of yards) {
    if (!canAdd()) break;
    if (yard.queueLength >= rule.queueLimit) continue;
    const kind: ShipKind = rule.aggression >= 2 && ships.length >= 3 ? 'siege' :
      rule.aggression >= 1 ? 'gunboat' : 'scout';
    if (obs.salvage - reservedSalvage < ECONOMY_RULES.ships[kind].cost) continue;
    emit({ type: 'enqueue', yardId: yard.id, shipKind: kind });
    reservedSalvage += ECONOMY_RULES.ships[kind].cost;
  }

  // Controlled exploration from authorized frontiers, never a hidden spawn.
  if (canAdd() && obs.explorationFrontiers.length) {
    const idle = ships.find(s => !s.busy && !usedShips.has(s.id));
    if (idle) {
      const options = [...obs.explorationFrontiers].sort((a,b) => a.y-b.y || a.x-b.x);
      const goal = options[stablePick(obs.seed, obs.slot, epoch, options.length)]!;
      emit({ type: 'move', shipId: idle.id, destination: goal }, idle.id);
    }
  }
  return { intents, nextDecisionUs: obs.nowUs + rule.intervalUs };
}
