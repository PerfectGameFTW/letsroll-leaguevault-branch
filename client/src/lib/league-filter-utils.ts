import type { League, Location } from "@shared/schema";
import { WEEKDAYS } from "@shared/schema";

export interface LeagueFilterOptions {
  showArchived: boolean;
  locationFilter: string;
}

export function buildLocationMap(
  locations: Location[]
): Record<number, string> {
  return locations.reduce(
    (acc, loc) => {
      acc[loc.id] = loc.name;
      return acc;
    },
    {} as Record<number, string>
  );
}

export function filterAndSortLeagues(
  leagues: League[],
  options: LeagueFilterOptions
): League[] {
  let filtered = options.showArchived
    ? leagues
    : leagues.filter((l) => l.active);

  if (options.locationFilter !== "all") {
    if (options.locationFilter === "none") {
      filtered = filtered.filter((l) => !l.locationId);
    } else {
      filtered = filtered.filter(
        (l) => l.locationId === parseInt(options.locationFilter)
      );
    }
  }

  return filtered.slice().sort((a, b) => {
    const aIdx = WEEKDAYS.indexOf(a.weekDay as (typeof WEEKDAYS)[number]);
    const bIdx = WEEKDAYS.indexOf(b.weekDay as (typeof WEEKDAYS)[number]);
    return aIdx - bIdx;
  });
}

export function countArchivedLeagues(leagues: League[]): number {
  return leagues.filter((l) => !l.active).length;
}
