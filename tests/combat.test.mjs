import test from "node:test";
import assert from "node:assert/strict";
import {
  COMBAT_RULES, armorDamage, canFire, createProjectile,
  firstProjectileHit, advanceProjectile, terrainLineOfSight, resolveImpact,
} from "../spacetimedb/src/sim/combat.ts";

const ship = (id, faction, x, y, kind = "scout", hp = 210, radius = .42) =>
  ({ entityType: "ship", id: BigInt(id), faction, x, y, kind, hp, radius });
const structure = (id, faction, x, y, kind = "platform", hp = 280, width = 1, height = 1) =>
  ({ entityType: "structure", id: BigInt(id), faction, x, y, kind, hp, width, height });
const point = (x, y) => ({ x, y });

test("reference-derived damage, range and cooldown are data-driven", () => {
  assert.equal(COMBAT_RULES.weapons.scout.damage, 18);
  assert.equal(COMBAT_RULES.weapons.gunboat.range, 7.2);
  assert.equal(COMBAT_RULES.weapons.siege.splash, 1.35);
  assert.equal(COMBAT_RULES.weapons.cannon.cooldownMs, 1400);
  assert.equal(canFire(950000n, 0n, 950), true);
  assert.equal(canFire(949999n, 0n, 950), false);
});
test("moving enemy evades fixed-heading projectile", () => {
  const p = createProjectile(point(1.5, 1.5), point(4.5, 1.5), "scout", 0);
  const result = advanceProjectile(p, .2, [ship(2, 1, 4.5, 3.5)]);
  assert.equal(result.impact, null);
  assert.equal(result.next, null);
});
test("earliest swept collision wins regardless of input order", () => {
  const p = createProjectile(point(1.5, 1.5), point(6.5, 1.5), "gunboat", 0);
  const result = advanceProjectile(p, .25, [ship(50, 1, 5.5, 1.5), ship(20, 1, 3.5, 1.5)]);
  assert.equal(result.impact?.hits[0]?.id, 20n);
  assert.ok(result.impact.point.x < 3.5);
});
test("friendly ships and structures cannot intercept or receive damage", () => {
  const p = createProjectile(point(1.5, 1.5), point(5.5, 1.5), "gunboat", 0);
  const result = advanceProjectile(p, .25,
    [ship(1, 0, 2.5, 1.5), structure(10, 0, 3, 1), ship(2, 1, 5, 1.5)]);
  assert.deepEqual(result.impact?.hits.map(hit => hit.id), [2n]);
});
test("terrain line-of-sight is blocked by ruins", () => {
  const terrain = new Uint8Array(64);
  assert.equal(terrainLineOfSight(point(1.5, 1.5), point(6.5, 1.5), terrain, 8), true);
  terrain[1 * 8 + 4] = 2;
  assert.equal(terrainLineOfSight(point(1.5, 1.5), point(6.5, 1.5), terrain, 8), false);
  assert.throws(() => terrainLineOfSight(point(0, 0), point(1, 1), terrain, 9), RangeError);
});
test("armor, structural multiplier and remaining HP are bounded", () => {
  assert.equal(armorDamage(18, "scout", "ship", .75), 16);
  assert.equal(armorDamage(18, "command_core", "structure", .75), 5);
  assert.equal(armorDamage(115, "command_core", "structure", 1.65), 175);
  const body = structure(3, 1, 3, 1, "platform", 5);
  const p = createProjectile(point(1.5, 1.5), point(4.5, 1.5), "siege", 0);
  const hit = firstProjectileHit(point(1.5, 1.5), point(5, 1.5), 0, [body]);
  assert.equal(resolveImpact(hit, p, [body]).hits[0].damage, 5);
});
test("splash damages nearby enemy but not intact covered deck or distant targets", () => {
  const p = createProjectile(point(1.5, 1.5), point(6.5, 1.5), "siege", 0);
  const bodies = [structure(1, 1, 4, 1), structure(2, 1, 4, 1, "workshop", 680),
    ship(3, 1, 5.4, 1.5), ship(4, 1, 8, 5)];
  const hit = firstProjectileHit(point(1.5, 1.5), point(6.5, 1.5), 0, bodies);
  assert.equal(hit.body.id, 2n);
  const ids = resolveImpact(hit, p, bodies).hits.map(entry => entry.id);
  assert.ok(ids.includes(2n) && ids.includes(3n));
  assert.ok(!ids.includes(1n) && !ids.includes(4n));
});
test("range expiry and invalid tick/shot fail safely", () => {
  assert.throws(() => createProjectile(point(1, 1), point(1, 1), "scout", 0), RangeError);
  assert.throws(() => createProjectile(point(1, 1), point(100, 1), "scout", 0), RangeError);
  const p = createProjectile(point(1.5, 1.5), point(2.5, 1.5), "scout", 0);
  assert.equal(advanceProjectile(p, .1, []).next, null);
  assert.throws(() => advanceProjectile(p, .5, []), RangeError);
});
