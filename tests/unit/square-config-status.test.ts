import { describe, it, expect } from 'vitest';
import {
  getMissingSquareFields,
  REQUIRED_SQUARE_FIELDS,
  SQUARE_FIELD_LABELS,
} from '@shared/schema';

describe('getMissingSquareFields (task #579)', () => {
  it('returns every required field when given null', () => {
    const missing = getMissingSquareFields(null);
    expect(missing).toEqual([...REQUIRED_SQUARE_FIELDS]);
    expect(missing).toHaveLength(3);
  });

  it('returns every required field when given undefined', () => {
    expect(getMissingSquareFields(undefined)).toEqual([...REQUIRED_SQUARE_FIELDS]);
  });

  it('returns every required field for an empty object', () => {
    expect(getMissingSquareFields({})).toEqual([...REQUIRED_SQUARE_FIELDS]);
  });

  it('returns an empty list when all three fields are present (raw shape)', () => {
    expect(
      getMissingSquareFields({
        appId: 'sq0idp-abc',
        accessToken: 'EAAAEv...secret',
        locationId: 'L123',
      }),
    ).toEqual([]);
  });

  it('returns an empty list when all three fields are present (public shape)', () => {
    expect(
      getMissingSquareFields({
        appId: 'sq0idp-abc',
        accessTokenConfigured: true,
        locationId: 'L123',
      }),
    ).toEqual([]);
  });

  it('treats whitespace-only strings as missing', () => {
    expect(
      getMissingSquareFields({
        appId: '   ',
        accessToken: '\t',
        locationId: '',
      }),
    ).toEqual(['appId', 'accessToken', 'locationId']);
  });

  it('treats accessTokenConfigured=false as missing even when raw token is empty', () => {
    expect(
      getMissingSquareFields({
        appId: 'sq0idp-abc',
        accessTokenConfigured: false,
        locationId: 'L123',
      }),
    ).toEqual(['accessToken']);
  });

  it('reports only the missing fields when one credential is partial', () => {
    expect(
      getMissingSquareFields({
        appId: 'sq0idp-abc',
        accessToken: '',
        locationId: 'L123',
      }),
    ).toEqual(['accessToken']);
  });

  it('preserves the canonical field order in the returned list', () => {
    // Critical for the UI which renders the labels in this exact order
    // ("Application ID, Access Token, Square Location ID"). A naive
    // refactor that walks the input object would produce a different,
    // non-deterministic order; pin it.
    const missing = getMissingSquareFields({});
    expect(missing).toEqual(['appId', 'accessToken', 'locationId']);
  });

  it('exposes a label for every required field', () => {
    for (const field of REQUIRED_SQUARE_FIELDS) {
      expect(SQUARE_FIELD_LABELS[field]).toBeTruthy();
      expect(typeof SQUARE_FIELD_LABELS[field]).toBe('string');
    }
  });

  it('treats null-valued fields as missing', () => {
    expect(
      getMissingSquareFields({
        appId: null,
        accessToken: null,
        locationId: null,
      }),
    ).toEqual([...REQUIRED_SQUARE_FIELDS]);
  });
});
