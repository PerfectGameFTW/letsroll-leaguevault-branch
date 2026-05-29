/**
 * Component test for the shared useSavedCardDefault hook (task #761).
 *
 * This hook consolidates the three previously-divergent "default to the
 * bowler's first saved card once the saved-cards query resolves"
 * implementations across the admin checkout (`payment-form`), bowler
 * setup (`payment-status-section`), and quick-pay (`payment-history-page`)
 * flows. The behavior that must hold for all three:
 *   - Once a first saved card id appears, switch the picker to "saved"
 *     and select that card.
 *   - If the saved-card set empties (id -> null), fall back to "new".
 *   - When `enabled` is false (e.g. admin form not on the credit-card
 *     payment type), force "new" regardless of saved cards.
 *   - The decision is keyed: a manual switch the user makes afterward is
 *     not clobbered on re-render unless the key actually changes.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { useSavedCardDefault } from '@/hooks/use-saved-card-default';

function Harness(props: {
  firstSavedCardId: string | null;
  enabled?: boolean;
  dependencyKey?: string;
  setCardMode: (mode: 'new' | 'saved') => void;
  setSelectedSavedCardId: (id: string) => void;
}) {
  useSavedCardDefault(props);
  return null;
}

describe('useSavedCardDefault (#761)', () => {
  it('switches to "saved" and selects the first card once one loads', () => {
    const setCardMode = vi.fn();
    const setSelectedSavedCardId = vi.fn();
    const { rerender } = render(
      <Harness
        firstSavedCardId={null}
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );

    // Initial run with no cards -> "new".
    expect(setCardMode).toHaveBeenLastCalledWith('new');
    expect(setSelectedSavedCardId).toHaveBeenLastCalledWith('');

    setCardMode.mockClear();
    setSelectedSavedCardId.mockClear();

    rerender(
      <Harness
        firstSavedCardId="card_123"
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );

    expect(setCardMode).toHaveBeenLastCalledWith('saved');
    expect(setSelectedSavedCardId).toHaveBeenLastCalledWith('card_123');
  });

  it('falls back to "new" when the saved-card set empties', () => {
    const setCardMode = vi.fn();
    const setSelectedSavedCardId = vi.fn();
    const { rerender } = render(
      <Harness
        firstSavedCardId="card_123"
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );
    expect(setCardMode).toHaveBeenLastCalledWith('saved');

    setCardMode.mockClear();
    setSelectedSavedCardId.mockClear();

    rerender(
      <Harness
        firstSavedCardId={null}
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );

    expect(setCardMode).toHaveBeenLastCalledWith('new');
    expect(setSelectedSavedCardId).toHaveBeenLastCalledWith('');
  });

  it('forces "new" when disabled even if a saved card is present', () => {
    const setCardMode = vi.fn();
    const setSelectedSavedCardId = vi.fn();
    render(
      <Harness
        firstSavedCardId="card_123"
        enabled={false}
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );

    expect(setCardMode).toHaveBeenLastCalledWith('new');
    expect(setSelectedSavedCardId).toHaveBeenLastCalledWith('');
  });

  it('does not re-apply the default on re-render when the key is unchanged', () => {
    const setCardMode = vi.fn();
    const setSelectedSavedCardId = vi.fn();
    const { rerender } = render(
      <Harness
        firstSavedCardId="card_123"
        dependencyKey="bowler-1"
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );
    expect(setCardMode).toHaveBeenCalledTimes(1);

    // Re-render with identical inputs: the hook must NOT clobber a
    // manual user switch by re-applying its default.
    rerender(
      <Harness
        firstSavedCardId="card_123"
        dependencyKey="bowler-1"
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );
    expect(setCardMode).toHaveBeenCalledTimes(1);
  });

  it('re-applies the default when the dependency key changes', () => {
    const setCardMode = vi.fn();
    const setSelectedSavedCardId = vi.fn();
    const { rerender } = render(
      <Harness
        firstSavedCardId="card_a"
        dependencyKey="bowler-1"
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );
    expect(setSelectedSavedCardId).toHaveBeenLastCalledWith('card_a');

    rerender(
      <Harness
        firstSavedCardId="card_b"
        dependencyKey="bowler-2"
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
      />,
    );
    expect(setSelectedSavedCardId).toHaveBeenLastCalledWith('card_b');
  });
});
