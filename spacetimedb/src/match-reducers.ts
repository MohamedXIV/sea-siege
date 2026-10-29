import { t } from "spacetimedb/server";
import spacetimedb, { matchDeadline } from "./schema.ts";
import { resolveMatchOutcome } from "./sim/match-outcome.ts";

/**
 * Deadline is a one-shot schedule row, created exactly once by startMatch.
 * The backend, not an individual client, chooses the winner at 12 minutes.
 */
export const finishMatchAtDeadline = spacetimedb.reducer(
  { onSchedule: matchDeadline },
  { arg: matchDeadline.rowType },
  (ctx, { arg }) => {
    if (!ctx.senderAuth.isInternal) throw new Error("Match deadline is internal-only");
    const schedule = ctx.db.matchDeadline.scheduledId.find(arg.scheduledId);
    if (!schedule) return; // Previous destruction victory canceled the deadline.
    const match = ctx.db.match.id.find(schedule.matchId);
    if (!match || match.phase !== "active") return; // Idempotent at match finish.
    const nowUs = ctx.timestamp.microsSinceUnixEpoch;
    if (nowUs < schedule.deadlineUs) throw new Error("Match deadline has not elapsed");

    const members = Array.from(ctx.db.matchMember.matchId.filter(match.id));
    const structures = Array.from(ctx.db.structure.matchId.filter(match.id));
    const ships = Array.from(ctx.db.ship.matchId.filter(match.id));
    const living = members.flatMap(member => {
      if (member.eliminated) return [];
      const core = structures.find(row =>
        row.ownerSlot === member.slot && row.kind === "command_core" && row.hp > 0,
      );
      if (!core) return [];
      return [{
        slot: member.slot, coreHp: core.hp,
        structures: structures.filter(row => row.ownerSlot === member.slot && row.hp > 0).length,
        ships: ships.filter(row => row.owner.isEqual(member.identity) && row.hp > 0).length,
        totalSalvageGathered: member.totalSalvageGathered,
      }];
    });
    const result = resolveMatchOutcome(living, true);
    if (!result) throw new Error("Match outcome unresolved after deadline");
    ctx.db.match.id.update({
      ...match, phase: "finished",
      winnerSlot: result.winnerSlot,
      victoryReason: result.reason,
      winningScore5: result.winningScore5 ?? 0n,
      endedAtUs: nowUs,
    });

    // All gameplay schedules stop; no stale periodic transaction should modify
    // the finished match. A one-shot reducer schedule auto-removes on success.
    for (const row of Array.from(ctx.db.economySchedule.matchId.filter(match.id)))
      ctx.db.economySchedule.scheduledId.delete(row.scheduledId);
    for (const row of Array.from(ctx.db.motionSchedule.matchId.filter(match.id)))
      ctx.db.motionSchedule.scheduledId.delete(row.scheduledId);
    for (const row of Array.from(ctx.db.combatSchedule.matchId.filter(match.id)))
      ctx.db.combatSchedule.scheduledId.delete(row.scheduledId);
    for (const row of Array.from(ctx.db.constructionSchedule.iter())) {
      const structure = ctx.db.structure.id.find(row.structureId);
      if (structure?.matchId === match.id)
        ctx.db.constructionSchedule.scheduledId.delete(row.scheduledId);
    }
    for (const projectile of Array.from(ctx.db.projectile.matchId.filter(match.id)))
      ctx.db.projectile.id.delete(projectile.id);
    for (const aim of Array.from(ctx.db.turretAim.matchId.filter(match.id)))
      ctx.db.turretAim.id.delete(aim.id);
  },
);
