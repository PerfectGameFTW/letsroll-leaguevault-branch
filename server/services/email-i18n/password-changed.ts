/**
 * Translations for the "your password was just changed" security
 * email (tasks #353, #409, #410).
 *
 * Adding a new locale: drop a new entry into `PASSWORD_CHANGED_I18N`
 * with the same shape as `en`. Keys are ISO 639-1 two-letter codes,
 * lower-cased. Anything that isn't an exact match falls back to
 * English (see `pickPasswordChangedLocale`). Region tags such as
 * `es-MX` collapse to their base language (`es`).
 *
 * Most strings here are plain text — the email helper splices them
 * into the HTML scaffold and applies HTML-escaping at the splice
 * points, so translators do NOT need to think about HTML, escaping,
 * or layout.
 *
 * EXCEPTION: `ifThisWasYou` and `ifThisWasntYou` are spliced into
 * the email RAW so the translator can place a `<strong>` emphasis
 * wherever it reads naturally in their language. These two keys
 * may contain a small, fixed set of trusted inline HTML tags
 * (currently just `<strong>`) and MUST NOT interpolate anything
 * user-controlled. All other keys are plain text.
 */

export interface PasswordChangedStrings {
  subject: string;
  greeting: (name: string) => string;
  intro: string;
  whenLabel: string;
  fromIpLabel: string;
  browserLabel: string;
  ifThisWasYou: string;
  ifThisWasntYou: string;
  footer: string;
  unknown: string;
  /**
   * Extra sentence inserted when the change was performed by an
   * administrator on the user's account, NOT by the user themselves
   * (task #416). Plain text — escaped by the email helper at splice
   * time. Omitted from the rendered HTML when the actor is `'self'`.
   */
  performedByAdmin: string;
}

const en: PasswordChangedStrings = {
  subject: 'Your LeagueVault password was just changed',
  greeting: (name: string) => `Hi ${name},`,
  intro:
    'The password on your LeagueVault account was just changed. As a security precaution, every other device that was signed in to your account has been signed out.',
  whenLabel: 'When',
  fromIpLabel: 'From IP',
  browserLabel: 'Browser',
  ifThisWasYou:
    "<strong>If this was you</strong>, no action is needed — you can ignore this email.",
  ifThisWasntYou:
    "<strong>If this wasn't you</strong>, your account may be compromised. Contact support immediately so we can help you regain control.",
  footer: 'Powered by LeagueVault',
  unknown: 'unknown',
  performedByAdmin:
    'This change was performed by an administrator on your account.',
};

const es: PasswordChangedStrings = {
  subject: 'Se acaba de cambiar la contraseña de tu cuenta de LeagueVault',
  greeting: (name: string) => `Hola ${name},`,
  intro:
    'Se acaba de cambiar la contraseña de tu cuenta de LeagueVault. Por motivos de seguridad, se ha cerrado la sesión en todos los demás dispositivos que tenían iniciada sesión en tu cuenta.',
  whenLabel: 'Cuándo',
  fromIpLabel: 'Desde IP',
  browserLabel: 'Navegador',
  ifThisWasYou:
    '<strong>Si fuiste tú</strong>, no hace falta hacer nada — puedes ignorar este mensaje.',
  ifThisWasntYou:
    '<strong>Si no fuiste tú</strong>, tu cuenta podría estar comprometida. Contacta con soporte de inmediato para que te ayudemos a recuperar el control.',
  footer: 'Servicio de LeagueVault',
  unknown: 'desconocido',
  performedByAdmin:
    'Un administrador realizó este cambio en tu cuenta.',
};

export const PASSWORD_CHANGED_I18N: Record<string, PasswordChangedStrings> = {
  en,
  es,
};

export const DEFAULT_PASSWORD_CHANGED_LOCALE = 'en';

/**
 * Resolve a user-supplied locale tag (or null) to a known set of
 * translations. Accepts BCP-47-ish input ("es-MX", "EN_us"); only
 * the leading two letters are honored. Unknown or empty input
 * yields the English default — security-critical emails must always
 * render, even if the user's stored language is corrupted.
 */
export function pickPasswordChangedLocale(
  locale: string | null | undefined,
): { code: string; strings: PasswordChangedStrings } {
  if (!locale || typeof locale !== 'string') {
    return { code: DEFAULT_PASSWORD_CHANGED_LOCALE, strings: en };
  }
  const tag = locale.trim().toLowerCase().slice(0, 2);
  const strings = PASSWORD_CHANGED_I18N[tag];
  if (strings) return { code: tag, strings };
  return { code: DEFAULT_PASSWORD_CHANGED_LOCALE, strings: en };
}
