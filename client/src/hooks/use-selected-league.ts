import { useState, useCallback } from "react";

const STORAGE_KEY = "bowler_selected_league_id";

function getStored(): number | null {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

function setStored(id: number | null) {
  try {
    if (id != null) {
      localStorage.setItem(STORAGE_KEY, String(id));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export function useSelectedLeague(urlLeagueId?: number | null) {
  const [selectedLeagueId, setSelectedLeagueIdState] = useState<number | null>(
    () => urlLeagueId ?? getStored()
  );

  const setSelectedLeagueId = useCallback((id: number | null) => {
    setSelectedLeagueIdState(id);
    setStored(id);
  }, []);

  return [selectedLeagueId, setSelectedLeagueId] as const;
}
