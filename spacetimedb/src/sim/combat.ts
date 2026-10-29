/** Pure authoritative combat geometry. No client input or database access. */
export const COMBAT_RULES = {
  tickMicroseconds: 100_000n,
  maxDeltaMicroseconds: 250_000n,
  minimumShipDamage: 4,
  minimumStructureDamage: 5,
  maxProjectilesPerMatch: 512,
  weapons: {
    scout: { range: 5.5, vision: 12, cooldownMs: 950, damage: 18, projectileSpeed: 18, splash: 0, structureMultiplier: .75, armor: 2 },
    gunboat: { range: 7.2, vision: 8.5, cooldownMs: 1350, damage: 44, projectileSpeed: 15, splash: 0, structureMultiplier: 1, armor: 7 },
    siege: { range: 11, vision: 9.5, cooldownMs: 2600, damage: 115, projectileSpeed: 12, splash: 1.35, structureMultiplier: 1.65, armor: 12 },
    cannon: { range: 8.5, vision: 9, cooldownMs: 1400, damage: 48, projectileSpeed: 16, splash: .5, structureMultiplier: 1, armor: 10 },
  },
  structureArmor: { command_core: 15, platform: 4, workshop: 8, shipyard: 8, cannon: 10, salvage_rig: 6 },
} as const;

export type WeaponKind = keyof typeof COMBAT_RULES.weapons;
export type Point = Readonly<{ x: number; y: number }>;
export type ShipCombatBody = Readonly<{
  entityType: 'ship'; id: bigint; faction: number; x: number; y: number;
  radius: number; hp: number; kind: string;
}>;
export type StructureCombatBody = Readonly<{
  entityType: 'structure'; id: bigint; faction: number;
  x: number; y: number; width: number; height: number; hp: number; kind: string;
}>;
export type CombatBody = ShipCombatBody | StructureCombatBody;
export type ProjectileState = Readonly<{
  x: number; y: number; vx: number; vy: number;
  sourceFaction: number; damage: number; splash: number;
  structureMultiplier: number; remainingRange: number;
}>;
export type ProjectileHit = Readonly<{ body: CombatBody; t: number; x: number; y: number }>;
export type Impact = Readonly<{
  point: Point; hits: readonly Readonly<{ entityType: CombatBody['entityType']; id: bigint; damage: number }>[];
}>;

export function weaponDefinition(kind: string) {
  return Object.prototype.hasOwnProperty.call(COMBAT_RULES.weapons, kind)
    ? COMBAT_RULES.weapons[kind as WeaponKind] : null;
}
export function canFire(shotTimeUs: bigint, lastFiredAtUs: bigint, cooldownMs: number): boolean {
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) throw new RangeError('Invalid cooldown');
  return shotTimeUs >= lastFiredAtUs && shotTimeUs - lastFiredAtUs >= BigInt(cooldownMs) * 1000n;
}
export function withinRange(a: Point, b: Point, range: number): boolean {
  return [a.x, a.y, b.x, b.y, range].every(Number.isFinite) && range >= 0 &&
    Math.hypot(a.x - b.x, a.y - b.y) <= range;
}
/** Industrial pillars and shoals block sight, but radar/visibility policy remains server-owned. */
export function terrainLineOfSight(a: Point, b: Point, cells: Uint8Array, size: number): boolean {
  if (!Number.isInteger(size) || size <= 0 || cells.length !== size * size) throw new RangeError('Invalid terrain');
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return false;
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const steps = Math.ceil(distance * 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + (b.x - a.x) * t), y = Math.floor(a.y + (b.y - a.y) * t);
    if (x < 0 || y < 0 || x >= size || y >= size || cells[y * size + x]! >= 2) return false;
  }
  return true;
}
/** Projectile heading is frozen at launch; no remembered target ID can guarantee a hit. */
export function createProjectile(source: Point, aim: Point, kind: WeaponKind, faction: number): ProjectileState {
  const rule = COMBAT_RULES.weapons[kind];
  if (![source.x, source.y, aim.x, aim.y].every(Number.isFinite) ||
      !Number.isInteger(faction) || faction < 0) throw new RangeError('Invalid fire input');
  const distance = Math.hypot(aim.x - source.x, aim.y - source.y);
  if (distance <= 0 || distance > rule.range + 1e-9) throw new RangeError('Target out of weapon range');
  return { x: source.x, y: source.y,
    vx: (aim.x - source.x) * rule.projectileSpeed / distance,
    vy: (aim.y - source.y) * rule.projectileSpeed / distance,
    sourceFaction: faction, damage: rule.damage, splash: rule.splash,
    structureMultiplier: rule.structureMultiplier, remainingRange: distance };
}
function firstSegmentCircle(a: Point, b: Point, center: Point, radius: number): number | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - center.x, fy = a.y - center.y;
  const aa = dx * dx + dy * dy;
  if (fx * fx + fy * fy <= radius * radius) return 0;
  if (aa === 0) return null;
  const bb = 2 * (fx * dx + fy * dy), cc = fx * fx + fy * fy - radius * radius;
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}
function firstSegmentRect(a: Point, b: Point, body: StructureCombatBody): number | null {
  let enter = 0, leave = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, body.x, body.x + body.width],
    [a.y, b.y - a.y, body.y, body.y + body.height],
  ]) {
    if (delta === 0) {
      if (origin < min || origin > max) return null;
      continue;
    }
    const u = (min - origin) / delta, v = (max - origin) / delta;
    enter = Math.max(enter, Math.min(u, v));
    leave = Math.min(leave, Math.max(u, v));
    if (enter > leave) return null;
  }
  return enter <= 1 ? enter : null;
}
/** An intact mounted building takes hits before the hidden deck beneath it. */
function isCoveredSurface(body: StructureCombatBody, all: readonly CombatBody[]): boolean {
  if (body.kind !== 'platform') return false;
  return all.some(other => other.entityType === 'structure' &&
    other.id !== body.id && other.faction === body.faction &&
    other.kind !== 'platform' && other.kind !== 'command_core' && other.hp > 0 &&
    body.x >= other.x && body.y >= other.y &&
    body.x + body.width <= other.x + other.width &&
    body.y + body.height <= other.y + other.height);
}
export function firstProjectileHit(from: Point, to: Point, faction: number, bodies: readonly CombatBody[]): ProjectileHit | null {
  let best: ProjectileHit | null = null;
  for (const body of bodies) {
    if (body.faction === faction || body.hp <= 0) continue;
    if (body.entityType === 'structure' && isCoveredSurface(body, bodies)) continue;
    const t = body.entityType === 'ship'
      ? firstSegmentCircle(from, to, body, body.radius) : firstSegmentRect(from, to, body);
    if (t === null) continue;
    if (!best || t < best.t - 1e-9 ||
      (Math.abs(t - best.t) <= 1e-9 &&
        (body.entityType < best.body.entityType ||
         (body.entityType === best.body.entityType && body.id < best.body.id)))) {
      best = { body, t, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
  }
  return best;
}
function distanceToBody(p: Point, body: CombatBody): number {
  if (body.entityType === 'ship') return Math.max(0, Math.hypot(p.x - body.x, p.y - body.y) - body.radius);
  const dx = Math.max(body.x - p.x, 0, p.x - body.x - body.width);
  const dy = Math.max(body.y - p.y, 0, p.y - body.y - body.height);
  return Math.hypot(dx, dy);
}
export function armorDamage(base: number, kind: string, entityType: CombatBody['entityType'], multiplier: number): number {
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(multiplier) || multiplier < 0) throw new RangeError('Invalid damage');
  const armor = entityType === 'ship' ? (weaponDefinition(kind)?.armor ?? 0)
    : (COMBAT_RULES.structureArmor[kind as keyof typeof COMBAT_RULES.structureArmor] ?? 0);
  const raw = (entityType === 'structure' ? base * multiplier : base) - armor;
  return Math.max(entityType === 'ship' ? COMBAT_RULES.minimumShipDamage : COMBAT_RULES.minimumStructureDamage,
    Math.round(raw));
}
export function resolveImpact(hit: ProjectileHit, projectile: ProjectileState, bodies: readonly CombatBody[]): Impact {
  const point = { x: hit.x, y: hit.y };
  const impacted = bodies.filter(body => body.hp > 0 && body.faction !== projectile.sourceFaction &&
    (body.entityType !== 'structure' || !isCoveredSurface(body, bodies)) &&
    ((body.id === hit.body.id && body.entityType === hit.body.entityType) ||
      (projectile.splash > 0 && distanceToBody(point, body) <= projectile.splash)));
  impacted.sort((a, b) => a.entityType.localeCompare(b.entityType) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { point, hits: impacted.map(body => ({
    entityType: body.entityType, id: body.id,
    damage: Math.min(body.hp, armorDamage(projectile.damage, body.kind, body.entityType, projectile.structureMultiplier)),
  })) };
}
/** Swept server impact-time collision at current vessel/structure positions. */
export function advanceProjectile(p: ProjectileState, seconds: number, bodies: readonly CombatBody[]):
  { next: ProjectileState | null; impact: Impact | null } {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 0.25) throw new RangeError('Invalid combat dt');
  if (![p.x,p.y,p.vx,p.vy,p.remainingRange,p.damage,p.splash,p.structureMultiplier].every(Number.isFinite) ||
    p.remainingRange < 0) throw new RangeError('Invalid projectile state');
  if (seconds === 0) return { next: p, impact: null };
  const speed = Math.hypot(p.vx, p.vy);
  if (speed <= 0) throw new RangeError('Invalid projectile velocity');
  const distance = Math.min(speed * seconds, p.remainingRange);
  const target = { x: p.x + p.vx / speed * distance, y: p.y + p.vy / speed * distance };
  const hit = firstProjectileHit(p, target, p.sourceFaction, bodies);
  if (hit) return { next: null, impact: resolveImpact(hit, p, bodies) };
  if (distance >= p.remainingRange - 1e-9) return { next: null, impact: null };
  return { next: { ...p, x: target.x, y: target.y, remainingRange: p.remainingRange - distance }, impact: null };
}
