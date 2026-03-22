import type { BowlerLeague, Bowler } from "@shared/schema";

export function filterActiveBowlerLeagues(
  allLeagues: BowlerLeague[],
  bowlerId: number
): BowlerLeague[] {
  const activeLeagues = allLeagues.filter(
    (bl) => bl.active && bl.bowlerId === bowlerId
  );

  return activeLeagues
    .reduce((unique: BowlerLeague[], current) => {
      const existingIndex = unique.findIndex(
        (bl) => bl.leagueId === current.leagueId
      );
      if (existingIndex === -1) {
        unique.push(current);
      } else if ((current.order ?? 0) > (unique[existingIndex].order ?? 0)) {
        unique[existingIndex] = current;
      }
      return unique;
    }, [])
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export interface TeamBowlerEntry {
  bowler: Bowler;
  bowlerLeague: BowlerLeague;
}

export function getTeamBowlers(
  bowlerLeagues: BowlerLeague[],
  bowlers: Bowler[],
  teamId: number
): TeamBowlerEntry[] {
  if (!bowlerLeagues.length || !bowlers.length) return [];

  const uniqueBowlerAssociations = bowlerLeagues
    .filter((bl: BowlerLeague) => bl.active && bl.teamId === teamId)
    .sort(
      (a: BowlerLeague, b: BowlerLeague) =>
        new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
    )
    .reduce((acc: BowlerLeague[], bl: BowlerLeague) => {
      if (!acc.find((existing) => existing.bowlerId === bl.bowlerId)) {
        acc.push(bl);
      }
      return acc;
    }, [])
    .sort(
      (a: BowlerLeague, b: BowlerLeague) => (a.order ?? 0) - (b.order ?? 0)
    );

  return uniqueBowlerAssociations
    .map((bl: BowlerLeague) => ({
      bowler: bowlers.find((b: Bowler) => b.id === bl.bowlerId),
      bowlerLeague: bl,
    }))
    .filter(
      (item): item is TeamBowlerEntry => !!item.bowler
    );
}
