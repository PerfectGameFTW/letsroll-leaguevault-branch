/**
 * Pins the APP_DOMAIN env-schema contract introduced in task #294 so a
 * future refactor of the regex can't silently weaken it. A misconfigured
 * value (scheme, path, leading dot) would otherwise only surface much
 * later as a malformed cookie domain or a malformed CSP origin in the
 * browser.
 */
import { describe, expect, it } from 'vitest';
import { envSchema } from '../../server/config';

const appDomain = envSchema.shape.APP_DOMAIN;

describe('APP_DOMAIN env-schema entry', () => {
  it.each([
    ['leaguevault.app'],
    ['staging.leaguevault.app'],
    ['preview-1234.leaguevault.app'],
    ['example.test'],
    ['my-org.example.co.uk'],
  ])('accepts the bare hostname %s', (value) => {
    const result = appDomain.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(value);
  });

  it.each([
    ['https://leaguevault.app'],
    ['http://leaguevault.app'],
    ['ftp://leaguevault.app'],
  ])('rejects values with a scheme (%s)', (value) => {
    expect(appDomain.safeParse(value).success).toBe(false);
  });

  it.each([
    ['leaguevault.app/'],
    ['leaguevault.app/foo'],
    ['leaguevault.app/foo/bar'],
  ])('rejects values with a path or trailing slash (%s)', (value) => {
    expect(appDomain.safeParse(value).success).toBe(false);
  });

  it('rejects a leading-dot value (.leaguevault.app)', () => {
    expect(appDomain.safeParse('.leaguevault.app').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(appDomain.safeParse('').success).toBe(false);
  });

  it('defaults to "leaguevault.app" when the env var is unset', () => {
    const result = appDomain.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('leaguevault.app');
  });

  it('surfaces the operator-friendly error message on a bad value', () => {
    const result = appDomain.safeParse('https://leaguevault.app');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(
        /bare hostname.*no scheme.*no path.*no leading dot/,
      );
    }
  });
});
