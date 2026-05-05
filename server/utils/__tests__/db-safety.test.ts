import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __testing, assertSafeDatabaseHost } from '../db-safety';

describe('assertSafeDatabaseHost', () => {
  // NODE_ENV + TEST_DATABASE_URL are saved/restored too because the
  // resolver added in Task #662 now picks the URL based on NODE_ENV.
  // Vitest defaults NODE_ENV=test, which would route every assertion
  // here through the TEST_DATABASE_URL branch and silently change the
  // var the function actually inspects.
  const ENV_KEYS = [
    'DEV_DB_OK',
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'DEV_DB_HOST_ALLOWLIST',
    'NODE_ENV',
  ] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    saved.clear();
    for (const k of ENV_KEYS) {
      saved.set(k, process.env[k]);
      delete process.env[k];
    }
    // Default each test into the dev-DB branch so the existing
    // assertions keep exercising DATABASE_URL. The dedicated
    // describe-block below opts in to NODE_ENV=test explicitly.
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('refuse paths', () => {
    it('refuses when DATABASE_URL is missing', () => {
      expect(() => assertSafeDatabaseHost('test-script')).toThrowError(
        /DATABASE_URL is not set/,
      );
    });

    it('refuses when DATABASE_URL is unparseable', () => {
      process.env.DATABASE_URL = 'not a url at all';
      expect(() => assertSafeDatabaseHost('test-script')).toThrowError(
        /could not be parsed as a URL/,
      );
    });

    it('refuses when DATABASE_URL host is empty', () => {
      // postgresql:/// has no host
      process.env.DATABASE_URL = 'postgresql:///mydb';
      expect(() => assertSafeDatabaseHost('test-script')).toThrowError(
        /(no hostname|could not be parsed)/,
      );
    });

    it('refuses an unrecognized prod-shaped Neon host with no allow-list', () => {
      process.env.DATABASE_URL =
        'postgresql://u:p@ep-cool-bird-99999999.us-west-2.aws.neon.tech/db';
      expect(() => assertSafeDatabaseHost('cleanup-test-organizations')).toThrowError(
        /not on the dev-database allow-list/,
      );
    });

    it('refuses an arbitrary remote host even when DEV_DB_HOST_ALLOWLIST is set to something else', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@db.acme.com/db';
      process.env.DEV_DB_HOST_ALLOWLIST = 'ep-dawn-unit-a66zn28k';
      expect(() => assertSafeDatabaseHost('cleanup')).toThrowError(
        /not on the dev-database allow-list/,
      );
    });

    it('does NOT treat a substring-blocklist value (e.g. "prod") as a blocker by itself', () => {
      // Sanity: the new design is allow-list-based, not blocklist-based.
      // A host whose name happens to contain "prod" is still refused — but
      // for the right reason (not on the allow-list), not because of a
      // generic substring match. This protects against the mistake the
      // architect flagged: prod hosts whose names DON'T contain "prod"
      // would have slipped through the old design.
      process.env.DATABASE_URL = 'postgresql://u:p@db-prod.example.com/db';
      expect(() => assertSafeDatabaseHost('cleanup')).toThrowError(
        /not on the dev-database allow-list/,
      );
    });
  });

  describe('allow paths', () => {
    it('allows when DEV_DB_OK=1 even with no DATABASE_URL', () => {
      process.env.DEV_DB_OK = '1';
      expect(() => assertSafeDatabaseHost('test-script')).not.toThrow();
    });

    it('allows when DEV_DB_OK=1 even against an obviously-prod host', () => {
      process.env.DEV_DB_OK = '1';
      process.env.DATABASE_URL = 'postgresql://u:p@db-production.acme.com/db';
      expect(() => assertSafeDatabaseHost('test-script')).not.toThrow();
    });

    it('allows localhost', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
      expect(() => assertSafeDatabaseHost('test-script')).not.toThrow();
    });

    it('allows 127.0.0.1', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/db';
      expect(() => assertSafeDatabaseHost('test-script')).not.toThrow();
    });

    it('allows an explicitly-allow-listed host substring', () => {
      process.env.DATABASE_URL =
        'postgresql://u:p@ep-dawn-unit-a66zn28k.us-west-2.aws.neon.tech/db';
      process.env.DEV_DB_HOST_ALLOWLIST = 'ep-dawn-unit-a66zn28k';
      expect(() => assertSafeDatabaseHost('cleanup')).not.toThrow();
    });

    it('honours a comma-separated allow-list', () => {
      process.env.DATABASE_URL =
        'postgresql://u:p@ep-second-host.us-west-2.aws.neon.tech/db';
      process.env.DEV_DB_HOST_ALLOWLIST =
        'ep-dawn-unit-a66zn28k, ep-second-host , ep-third-one';
      expect(() => assertSafeDatabaseHost('cleanup')).not.toThrow();
    });

    it('matches host case-insensitively against the allow-list', () => {
      process.env.DATABASE_URL =
        'postgresql://u:p@EP-DAWN-UNIT-A66ZN28K.us-west-2.aws.neon.tech/db';
      process.env.DEV_DB_HOST_ALLOWLIST = 'ep-dawn-unit-a66zn28k';
      expect(() => assertSafeDatabaseHost('cleanup')).not.toThrow();
    });
  });

  describe('NODE_ENV=test branch (Task #662)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('refuses when TEST_DATABASE_URL is missing (DATABASE_URL alone is ignored in test mode)', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@localhost/dev';
      expect(() => assertSafeDatabaseHost('test-script')).toThrowError(
        /TEST_DATABASE_URL is not set/,
      );
    });

    it('inspects TEST_DATABASE_URL host (not DATABASE_URL) when in test mode', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@localhost/dev';
      process.env.TEST_DATABASE_URL =
        'postgresql://u:p@ep-cool-bird-99999999.us-west-2.aws.neon.tech/db';
      expect(() => assertSafeDatabaseHost('cleanup')).toThrowError(
        /not on the dev-database allow-list/,
      );
    });

    it('honours DEV_DB_HOST_ALLOWLIST against the TEST_DATABASE_URL host', () => {
      process.env.DATABASE_URL = 'postgresql://u:p@db-prod.example.com/db';
      process.env.TEST_DATABASE_URL =
        'postgresql://u:p@ep-test-host-12345.us-west-2.aws.neon.tech/db';
      process.env.DEV_DB_HOST_ALLOWLIST = 'ep-test-host-12345';
      expect(() => assertSafeDatabaseHost('cleanup')).not.toThrow();
    });
  });

  describe('parseAllowlist (internal)', () => {
    const { parseAllowlist } = __testing;

    it('returns [] for undefined / empty', () => {
      expect(parseAllowlist(undefined)).toEqual([]);
      expect(parseAllowlist('')).toEqual([]);
      expect(parseAllowlist('   ')).toEqual([]);
    });

    it('splits, trims, lowercases, and drops empties', () => {
      expect(parseAllowlist(' Foo ,, BAR,baz ,')).toEqual(['foo', 'bar', 'baz']);
    });
  });
});
