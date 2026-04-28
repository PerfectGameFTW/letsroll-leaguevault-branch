import { describe, it, expect } from 'vitest';
import {
  getMissingCloverFields,
  REQUIRED_CLOVER_FIELDS,
  CLOVER_FIELD_LABELS,
} from '@shared/schema';

describe('getMissingCloverFields (task #575)', () => {
  it('returns every required field when given null', () => {
    const missing = getMissingCloverFields(null);
    expect(missing).toEqual([...REQUIRED_CLOVER_FIELDS]);
    expect(missing).toHaveLength(4);
  });

  it('returns every required field when given undefined', () => {
    expect(getMissingCloverFields(undefined)).toEqual([...REQUIRED_CLOVER_FIELDS]);
  });

  it('returns every required field for an empty object', () => {
    expect(getMissingCloverFields({})).toEqual([...REQUIRED_CLOVER_FIELDS]);
  });

  it('returns an empty list when all four fields are present (raw shape)', () => {
    expect(
      getMissingCloverFields({
        apiToken: 'secret',
        merchantId: 'M123',
        publicTokenizerKey: 'pk_x',
        environment: 'sandbox',
      }),
    ).toEqual([]);
  });

  it('returns an empty list when all four fields are present (public shape)', () => {
    expect(
      getMissingCloverFields({
        apiTokenConfigured: true,
        merchantId: 'M123',
        publicTokenizerKey: 'pk_x',
        environment: 'production',
      }),
    ).toEqual([]);
  });

  it('treats whitespace-only strings as missing', () => {
    expect(
      getMissingCloverFields({
        apiToken: '   ',
        merchantId: '\t',
        publicTokenizerKey: '',
        environment: 'sandbox',
      }),
    ).toEqual(['apiToken', 'merchantId', 'publicTokenizerKey']);
  });

  it('treats a whitespace-only environment value as missing too', () => {
    expect(
      getMissingCloverFields({
        apiTokenConfigured: true,
        merchantId: 'M',
        publicTokenizerKey: 'pk',
        environment: '   ',
      }),
    ).toEqual(['environment']);
  });

  it('reports a partial config that is missing only the api token', () => {
    expect(
      getMissingCloverFields({
        apiTokenConfigured: false,
        merchantId: 'M',
        publicTokenizerKey: 'pk',
        environment: 'sandbox',
      }),
    ).toEqual(['apiToken']);
  });

  it('reports a partial config that is missing the public tokenizer key', () => {
    expect(
      getMissingCloverFields({
        apiTokenConfigured: true,
        merchantId: 'M',
        environment: 'sandbox',
      }),
    ).toEqual(['publicTokenizerKey']);
  });

  it('exports a human label for every required field', () => {
    for (const field of REQUIRED_CLOVER_FIELDS) {
      expect(CLOVER_FIELD_LABELS[field]).toBeDefined();
      expect(CLOVER_FIELD_LABELS[field].length).toBeGreaterThan(0);
    }
  });
});
