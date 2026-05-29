import { useState } from "react";

interface UseSavedCardDefaultOptions {
  /** Id of the bowler's first saved card, or null when none are loaded. */
  firstSavedCardId: string | null;
  /**
   * When false, the picker is forced back to "new" regardless of saved
   * cards (e.g. the admin form is not on the credit-card payment type).
   * Defaults to true.
   */
  enabled?: boolean;
  /**
   * Extra inputs that should re-run the defaulting decision when they
   * change (e.g. the selected bowler / payment type in the admin form).
   * Combined into the change-detection key alongside `firstSavedCardId`.
   */
  dependencyKey?: string;
  setCardMode: (mode: "new" | "saved") => void;
  setSelectedSavedCardId: (id: string) => void;
}

/**
 * Default the card picker to the bowler's first saved card once the
 * saved-cards query resolves (and back to "new" if the set empties or the
 * flow is disabled). Done as a render-time adjustment keyed on the loaded
 * id rather than an effect, so the choice settles before paint and only
 * re-applies when the key itself changes — a manual switch the user makes
 * afterward is never clobbered.
 *
 * Consolidates the three previously-divergent implementations across the
 * admin checkout (`payment-form`), bowler setup (`payment-status-section`),
 * and quick-pay (`payment-history-page`) flows.
 */
export function useSavedCardDefault({
  firstSavedCardId,
  enabled = true,
  dependencyKey = "",
  setCardMode,
  setSelectedSavedCardId,
}: UseSavedCardDefaultOptions): void {
  const key = `${dependencyKey}|${firstSavedCardId ?? ""}|${enabled ? "1" : "0"}`;
  const [prevKey, setPrevKey] = useState<string | undefined>(undefined);

  if (key !== prevKey) {
    setPrevKey(key);
    if (enabled && firstSavedCardId !== null) {
      setCardMode("saved");
      setSelectedSavedCardId(firstSavedCardId);
    } else {
      setCardMode("new");
      setSelectedSavedCardId("");
    }
  }
}
