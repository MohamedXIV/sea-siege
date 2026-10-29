/** Server-only sensor filtering. Never return all enemy rows to bot-policy. */
import { terrainLineOfSight } from './combat.ts';
import type { VisibleEnemy, Position } from './bot-policy.ts';

export type Sensor = Readonly<{ id: bigint; position: Position; radius: number }>;
export type EnemyContact = Readonly<{ id: bigint; faction: number;
  entityType: 'ship' | 'structure'; position: Position; alive: boolean }>;

/**
 * Inputs must come from authoritative server tables, never client reports.
 * Spatial visibility is recomputed from server-owned sensors and terrain.
 * This is not yet a full player FoW subscription or persistent exploration map.
 */
export function detectBotEnemies(
  ownSlot: number, nowUs: bigint,
  sensors: readonly Sensor[], allContacts: readonly EnemyContact[],
  terrain: Uint8Array, mapCells: number,
): readonly VisibleEnemy[] {
  if (!Number.isSafeInteger(ownSlot) || ownSlot < 0 || nowUs < 0n ||
      !Number.isInteger(mapCells) || mapCells < 2 || terrain.length !== mapCells * mapCells ||
      sensors.some(s => !Number.isFinite(s.radius) || s.radius < 0 ||
        !Number.isFinite(s.position.x) || !Number.isFinite(s.position.y)) ||
      allContacts.some(c => !Number.isSafeInteger(c.faction) || c.faction < 0 ||
        !Number.isFinite(c.position.x) || !Number.isFinite(c.position.y))) {
    throw new RangeError('Invalid authoritative sensor state');
  }
  const result: VisibleEnemy[] = [];
  const visible = new Set<string>();
  const sortedSensors = [...sensors].sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sortedContacts = [...allContacts].sort((a,b)=>
    a.id < b.id ? -1 : a.id > b.id ? 1 : a.entityType.localeCompare(b.entityType));
  for (const contact of sortedContacts) {
    if (!contact.alive || contact.faction === ownSlot) continue;
    const key = contact.entityType + ':' + contact.id.toString();
    if (visible.has(key)) continue;
    if (!sortedSensors.some(sensor =>
      Math.hypot(sensor.position.x - contact.position.x,
        sensor.position.y - contact.position.y) <= sensor.radius &&
      terrainLineOfSight(sensor.position, contact.position, terrain, mapCells))) continue;
    visible.add(key);
    result.push({id:contact.id,entityType:contact.entityType,
      position:contact.position,observedAtUs:nowUs});
  }
  return result;
}
