/**
 * Unit tests for the pure helpers behind the auth-throttle UI
 * (tasks #355, #411). These don't need a DOM — they cover the
 * `parseRetryAfterSeconds` parser exposed from the query client
 * and the `formatCountdown` phrasing helper used by the throttle
 * banner across change-password, login, and forgot-password.
 *
 * The hook itself (`useThrottleCountdown`) is intentionally NOT
 * exercised here because the project's vitest config runs in a
 * `node` environment with no React renderer; component-level
 * coverage is the job of task #412.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRetryAfterSeconds } from '../../client/src/lib/queryClient';
import {
  DEFAULT_THROTTLE_FALLBACK_SECONDS,
  formatCountdown,
} from '../../client/src/hooks/use-throttle-countdown';

describe('parseRetryAfterSeconds (task #411 made it exported)', () => {
  beforeEach(() => {
    // Pin "now" so HTTP-date arithmetic and RateLimit-Reset
    // heuristics are deterministic across environments.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T15:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns null when both headers are absent', () => {
    expect(parseRetryAfterSeconds(null, null)).toBeNull();
  });

  it('parses a Retry-After delta-seconds integer', () => {
    expect(parseRetryAfterSeconds('120', null)).toBe(120);
    expect(parseRetryAfterSeconds('0', null)).toBe(0);
    expect(parseRetryAfterSeconds('  60  ', null)).toBe(60);
  });

  it('parses a Retry-After HTTP-date and clamps to delta-seconds', () => {
    // 90 seconds in the future from the pinned "now".
    const future = new Date('2026-04-24T15:01:30Z').toUTCString();
    expect(parseRetryAfterSeconds(future, null)).toBe(90);
  });

  it('clamps a past Retry-After date to 0 (never negative)', () => {
    const past = new Date('2026-04-24T14:00:00Z').toUTCString();
    expect(parseRetryAfterSeconds(past, null)).toBe(0);
  });

  it('falls back to RateLimit-Reset when Retry-After is missing', () => {
    expect(parseRetryAfterSeconds(null, '45')).toBe(45);
  });

  it('treats large RateLimit-Reset values as absolute epoch seconds', () => {
    // ~2 minutes in the future expressed as an absolute unix epoch.
    const futureEpoch = Math.floor(
      new Date('2026-04-24T15:02:00Z').getTime() / 1000,
    );
    expect(parseRetryAfterSeconds(null, String(futureEpoch))).toBe(120);
  });

  it('Retry-After takes precedence over RateLimit-Reset', () => {
    expect(parseRetryAfterSeconds('30', '999')).toBe(30);
  });

  it('returns null on garbage input rather than throwing', () => {
    expect(parseRetryAfterSeconds('not-a-number', null)).toBeNull();
    expect(parseRetryAfterSeconds(null, 'banana')).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('returns the "any moment" copy at or below zero', () => {
    expect(formatCountdown(0)).toBe('any moment now');
    expect(formatCountdown(-5)).toBe('any moment now');
  });

  it('returns whole seconds with correct singular / plural', () => {
    expect(formatCountdown(1)).toBe('1 second');
    expect(formatCountdown(2)).toBe('2 seconds');
    expect(formatCountdown(59)).toBe('59 seconds');
  });

  it('rolls over to whole minutes (rounded up) at 60s and beyond', () => {
    expect(formatCountdown(60)).toBe('1 minute');
    expect(formatCountdown(61)).toBe('2 minutes');
    expect(formatCountdown(120)).toBe('2 minutes');
    expect(formatCountdown(121)).toBe('3 minutes');
    expect(formatCountdown(900)).toBe('15 minutes');
  });
});

describe('DEFAULT_THROTTLE_FALLBACK_SECONDS', () => {
  it('is a sane positive number under typical limiter windows', () => {
    // Pin the contract: must be a positive number AND strictly less
    // than the typical 15-minute auth-limiter window so the local
    // banner clears before the server-side window does (otherwise
    // users would still see "wait" after the limiter has reset).
    expect(DEFAULT_THROTTLE_FALLBACK_SECONDS).toBeGreaterThan(0);
    expect(DEFAULT_THROTTLE_FALLBACK_SECONDS).toBeLessThan(15 * 60);
  });
});
