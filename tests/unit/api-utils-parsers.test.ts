/**
 * Pure-function tests for the tri-state query-parser helpers added in
 * task #421 (`server/utils/api.ts`). These pin the contract that
 * every list endpoint now relies on:
 *
 *   undefined → param missing or empty (treat as "no filter")
 *   null      → present but malformed (route should 400)
 *   value     → parsed cleanly
 *
 * The route-level tests in `list-routes-filter-validation.test.ts`
 * verify the behaviour end-to-end through Express; this file pins
 * the helper itself in isolation so we can be precise about edge
 * cases (negative numbers, leading +, decimals, arrays, etc.).
 */
import { describe, expect, it } from 'vitest';
import {
  parseOptionalIntParam,
  parseOptionalDateParam,
  parseOptionalIntListParam,
} from '../../server/utils/api.js';

describe('parseOptionalIntParam', () => {
  it('returns undefined for a missing param', () => {
    expect(parseOptionalIntParam(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string (no-filter sentinel)', () => {
    // Regression pin: `?leagueId=` (cleared form input) must not 400.
    expect(parseOptionalIntParam('')).toBeUndefined();
  });

  it('parses a positive integer', () => {
    expect(parseOptionalIntParam('42')).toBe(42);
  });

  it('parses a negative integer', () => {
    expect(parseOptionalIntParam('-7')).toBe(-7);
  });

  it('parses zero', () => {
    expect(parseOptionalIntParam('0')).toBe(0);
  });

  it('rejects partially-numeric input (the whole point of the strict parser)', () => {
    // `parseInt("42abc")` would return 42 — the historical bug.
    expect(parseOptionalIntParam('42abc')).toBeNull();
  });

  it('rejects pure non-numeric input', () => {
    expect(parseOptionalIntParam('foo')).toBeNull();
  });

  it('rejects decimals (we want integer ids only)', () => {
    expect(parseOptionalIntParam('1.5')).toBeNull();
  });

  it('rejects whitespace-padded input', () => {
    expect(parseOptionalIntParam(' 42')).toBeNull();
    expect(parseOptionalIntParam('42 ')).toBeNull();
  });

  it('rejects a leading + sign (regex is `-?` only)', () => {
    expect(parseOptionalIntParam('+42')).toBeNull();
  });

  it('rejects array values (Express normalises duplicates to arrays)', () => {
    // `?leagueId=1&leagueId=2` → ['1', '2'] — definitionally malformed
    // for a single-value filter.
    expect(parseOptionalIntParam(['1', '2'])).toBeNull();
  });

  it('rejects object values', () => {
    expect(parseOptionalIntParam({ a: 1 })).toBeNull();
  });

  it('rejects numeric-typed values (we expect strings off the wire)', () => {
    // The helper is for query-string params, which Express always
    // gives us as strings. A raw number means the caller bypassed
    // that contract and should be told.
    expect(parseOptionalIntParam(42)).toBeNull();
  });
});

describe('parseOptionalDateParam', () => {
  it('returns undefined for a missing param', () => {
    expect(parseOptionalDateParam(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseOptionalDateParam('')).toBeUndefined();
  });

  it('parses an ISO date string', () => {
    const d = parseOptionalDateParam('2026-01-05');
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).toISOString().slice(0, 10)).toBe('2026-01-05');
  });

  it('rejects an unparseable date string', () => {
    expect(parseOptionalDateParam('not-a-date')).toBeNull();
  });

  it('rejects array values', () => {
    expect(parseOptionalDateParam(['2026-01-05'])).toBeNull();
  });
});

describe('parseOptionalIntListParam', () => {
  it('returns undefined for a missing param', () => {
    expect(parseOptionalIntListParam(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseOptionalIntListParam('')).toBeUndefined();
  });

  it('parses a single id', () => {
    expect(parseOptionalIntListParam('42')).toEqual([42]);
  });

  it('parses a comma-separated list', () => {
    expect(parseOptionalIntListParam('1,2,3')).toEqual([1, 2, 3]);
  });

  it('rejects the whole list when ANY element is malformed', () => {
    // Important: silently dropping the bad element would hide the
    // typo from the caller, who would then see results scoped to
    // the wrong subset.
    expect(parseOptionalIntListParam('1,foo,3')).toBeNull();
  });

  it('rejects partially-numeric elements (1,2abc,3)', () => {
    expect(parseOptionalIntListParam('1,2abc,3')).toBeNull();
  });

  it('rejects empty elements (1,,3 — likely a UI bug worth surfacing)', () => {
    expect(parseOptionalIntListParam('1,,3')).toBeNull();
  });

  it('rejects array values', () => {
    expect(parseOptionalIntListParam(['1,2'])).toBeNull();
  });
});
