import { t } from "spacetimedb/server";
import spacetimedb from "./schema.ts";

const completedStanding = t.row("CompletedFactionStanding", {
  id: t.u64().primaryKey(),
  matchId: t.u64(),
  slot: t.u32(),
  controller: t.string(),
  eliminated: t.bool(),
  coreHp: t.u32(),
  structures: t.u32(),
  ships: t.u32(),
  ironGathered: t.u64(),
  advancedGathered: t.u64(),
  score5: t.u64(),
});

/** Each player may inspect only the immutable end results of matches they joined. */
export const myCompletedStandings = spacetimedb.view(
  { name: "my_completed_standings", public: true },
  t.array(completedStanding),
  ctx => {
    const seen = new Set<bigint>();
    const results: Array<{
      id: bigint; matchId: bigint; slot: number; controller: string;
      eliminated: boolean; coreHp: number; structures: number; ships: number;
      ironGathered: bigint; advancedGathered: bigint; score5: bigint;
    }> = [];
    for (const member of ctx.db.matchMember.identity.filter(ctx.sender)) {
      if (seen.has(member.matchId)) continue;
      seen.add(member.matchId);
      const match = ctx.db.match.id.find(member.matchId);
      if (!match || match.phase !== "finished") continue;
      for (const row of ctx.db.matchFinalStanding.matchId.filter(member.matchId)) {
        results.push({
          id: row.id, matchId: row.matchId, slot: row.slot,
          controller: row.controller, eliminated: row.eliminated,
          coreHp: row.coreHp, structures: row.structures, ships: row.ships,
          ironGathered: row.ironGathered, advancedGathered: row.advancedGathered,
          score5: row.score5,
        });
      }
    }
    return results.sort((a, b) =>
      a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : a.slot - b.slot);
  },
);
