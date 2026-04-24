/**
 * Unit tests for the password-changed email locale resolver and the
 * end-to-end render pass via `sendPasswordChangedNotification`
 * (task #410).
 *
 * The route-level wiring tests
 * (tests/unit/change-password-notification.test.ts and
 * tests/unit/set-password-notification.test.ts) verify that the
 * helper FIRES with the recipient's locale; this file pins down
 * what the helper actually RENDERS, which the route tests can't
 * inspect because they mock the helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pickPasswordChangedLocale,
  PASSWORD_CHANGED_I18N,
  DEFAULT_PASSWORD_CHANGED_LOCALE,
} from '../../server/services/email-i18n/password-changed';

describe('pickPasswordChangedLocale (task #410)', () => {
  it('returns English for null / undefined / empty input', () => {
    for (const v of [null, undefined, '']) {
      const r = pickPasswordChangedLocale(v as string | null | undefined);
      expect(r.code).toBe('en');
      expect(r.strings).toBe(PASSWORD_CHANGED_I18N.en);
    }
  });

  it('returns Spanish for "es" and case-/region-tag variants', () => {
    for (const v of ['es', 'ES', 'es-MX', 'es_AR', '  es  ']) {
      const r = pickPasswordChangedLocale(v);
      expect(r.code).toBe('es');
      expect(r.strings).toBe(PASSWORD_CHANGED_I18N.es);
    }
  });

  it('falls back to English on unknown locales rather than throwing', () => {
    for (const v of ['xx', 'klingon', '12', '!!']) {
      const r = pickPasswordChangedLocale(v);
      expect(r.code).toBe(DEFAULT_PASSWORD_CHANGED_LOCALE);
      expect(r.strings).toBe(PASSWORD_CHANGED_I18N.en);
    }
  });

  it('every supported locale ships every required key', () => {
    const required: Array<keyof typeof PASSWORD_CHANGED_I18N.en> = [
      'subject',
      'greeting',
      'intro',
      'whenLabel',
      'fromIpLabel',
      'browserLabel',
      'ifThisWasYou',
      'ifThisWasntYou',
      'footer',
      'unknown',
    ];
    for (const [code, strings] of Object.entries(PASSWORD_CHANGED_I18N)) {
      for (const key of required) {
        expect(
          strings[key],
          `locale '${code}' is missing key '${key}'`,
        ).toBeTruthy();
      }
    }
  });
});

// --- End-to-end render verification: stub SendGrid + env, then ----
// inspect the message handed to sgMail.send(). -----------------------

const sendMock = vi.fn(async () => undefined);

vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: (...a: unknown[]) => sendMock.apply(null, a as never),
  },
}));

vi.mock('../../server/config', () => ({
  env: { SENDGRID_API_KEY: 'sg-test', APP_DOMAIN: 'leaguevault.test' },
  isDev: false,
}));

vi.mock('../../server/storage', () => ({ storage: {} }));
vi.mock('../../server/utils/pii', () => ({ maskEmail: (e: string) => e }));

// `getBaseUrl` builds a URL from req-ish data; we just need a stable
// support link in the rendered HTML.
const renderedHtml = async (locale: string | null | undefined) => {
  const { sendPasswordChangedNotification } = await import('../../server/services/email');
  sendMock.mockClear();
  const ok = await sendPasswordChangedNotification(
    'recipient@vitest.local',
    'Pat Bowler',
    {
      changedAt: new Date('2026-04-24T15:00:00Z'),
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0 vitest',
      locale,
    },
  );
  expect(ok).toBe(true);
  expect(sendMock).toHaveBeenCalledTimes(1);
  const msg = (sendMock.mock.calls[0] as unknown as Array<{ subject: string; html: string }>)[0];
  return { subject: msg.subject, html: msg.html };
};

beforeEach(() => sendMock.mockClear());
afterEach(() => vi.clearAllMocks());

describe('sendPasswordChangedNotification — locale rendering (task #410)', () => {
  it('renders English subject + body when locale is null', async () => {
    const { subject, html } = await renderedHtml(null);
    expect(subject).toBe(PASSWORD_CHANGED_I18N.en.subject);
    expect(html).toContain('Hi Pat Bowler');
    expect(html).toContain('When');
    expect(html).toContain('From IP');
    expect(html).toContain('Browser');
    expect(html).toContain('If this was you');
    expect(html).toContain('lang="en"');
  });

  it('renders Spanish subject + body when locale is "es"', async () => {
    const { subject, html } = await renderedHtml('es');
    expect(subject).toBe(PASSWORD_CHANGED_I18N.es.subject);
    expect(html).toContain('Hola Pat Bowler');
    expect(html).toContain('Cuándo');
    expect(html).toContain('Desde IP');
    expect(html).toContain('Navegador');
    expect(html).toContain('Si fuiste tú');
    expect(html).toContain('lang="es"');
    // English copy must NOT leak into a Spanish render.
    expect(html).not.toContain('From IP');
    expect(html).not.toContain("If this wasn't you");
  });

  it('region-tagged "es-MX" still picks Spanish', async () => {
    const { subject, html } = await renderedHtml('es-MX');
    expect(subject).toBe(PASSWORD_CHANGED_I18N.es.subject);
    expect(html).toContain('lang="es"');
  });

  it('unknown locale falls back to English so the email always renders', async () => {
    const { subject, html } = await renderedHtml('klingon');
    expect(subject).toBe(PASSWORD_CHANGED_I18N.en.subject);
    expect(html).toContain('lang="en"');
  });

  it('escapes name HTML exactly once (regression: previously double-encoded "&")', async () => {
    // Earlier draft escaped the name BEFORE handing it to the
    // greeting template AND then escaped the whole sentence,
    // turning "A&B" into "A&amp;amp;B". Pin the fixed behaviour:
    // the ampersand should appear single-encoded as `&amp;`, never
    // `&amp;amp;`, in either the English OR Spanish render.
    const { sendPasswordChangedNotification } = await import('../../server/services/email');
    sendMock.mockClear();
    await sendPasswordChangedNotification(
      'recipient@vitest.local',
      'A&B Lanes',
      {
        changedAt: new Date('2026-04-24T15:00:00Z'),
        ipAddress: '203.0.113.9',
        userAgent: 'ua',
        locale: 'es',
      },
    );
    const msg = (sendMock.mock.calls[0] as unknown as Array<{ html: string }>)[0];
    expect(msg.html).toContain('A&amp;B Lanes');
    expect(msg.html).not.toContain('A&amp;amp;B');
  });
});
