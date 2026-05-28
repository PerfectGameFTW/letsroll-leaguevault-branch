/**
 * Translations for the "your account is temporarily locked" security
 * email (task #357). Sent when a user crosses the failed-password
 * threshold on /api/account/change-password and the endpoint is
 * temporarily disabled for that user.
 *
 * Adding a new locale: drop a new entry into `ACCOUNT_LOCKOUT_I18N`
 * with the same shape as `en`. Keys are ISO 639-1 two-letter codes,
 * lower-cased. Anything that isn't an exact match falls back to
 * English (see `pickAccountLockoutLocale`). Region tags such as
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

export interface AccountLockoutStrings {
  subject: string;
  greeting: (name: string) => string;
  intro: string;
  whenLabel: string;
  fromIpLabel: string;
  browserLabel: string;
  unlocksAtLabel: string;
  ifThisWasYou: string;
  ifThisWasntYou: string;
  resetCta: string;
  footer: string;
  unknown: string;
}

const en: AccountLockoutStrings = {
  subject: 'Your LeagueVault account is temporarily locked',
  greeting: (name: string) => `Hi ${name},`,
  intro:
    'We just temporarily locked the change-password endpoint on your LeagueVault account because someone made too many failed current-password attempts in a short time. As a precaution, every device that was signed in to your account has been signed out.',
  whenLabel: 'When',
  fromIpLabel: 'From IP',
  browserLabel: 'Browser',
  unlocksAtLabel: 'Lock lifts at',
  ifThisWasYou:
    "<strong>If this was you</strong> mistyping your current password, you can reset it now using the link below — that flow does not require your existing password.",
  ifThisWasntYou:
    "<strong>If this wasn't you</strong>, your account may be under attack from someone who already had access to a session. Reset your password right away and contact support.",
  resetCta: 'Reset your password',
  footer: 'Powered by LeagueVault',
  unknown: 'unknown',
};

const es: AccountLockoutStrings = {
  subject: 'Tu cuenta de LeagueVault está bloqueada temporalmente',
  greeting: (name: string) => `Hola ${name},`,
  intro:
    'Acabamos de bloquear temporalmente el cambio de contraseña en tu cuenta de LeagueVault porque alguien hizo demasiados intentos fallidos con la contraseña actual en poco tiempo. Como medida de seguridad, hemos cerrado la sesión en todos los dispositivos.',
  whenLabel: 'Cuándo',
  fromIpLabel: 'Desde IP',
  browserLabel: 'Navegador',
  unlocksAtLabel: 'El bloqueo se levanta',
  ifThisWasYou:
    '<strong>Si fuiste tú</strong> escribiendo mal tu contraseña actual, puedes restablecerla ahora con el enlace de abajo — ese proceso no requiere tu contraseña anterior.',
  ifThisWasntYou:
    '<strong>Si no fuiste tú</strong>, tu cuenta podría estar siendo atacada por alguien que ya tenía acceso a una sesión. Restablece tu contraseña de inmediato y contacta con soporte.',
  resetCta: 'Restablecer contraseña',
  footer: 'Servicio de LeagueVault',
  unknown: 'desconocido',
};

const ACCOUNT_LOCKOUT_I18N: Record<string, AccountLockoutStrings> = {
  en,
  es,
};

const DEFAULT_ACCOUNT_LOCKOUT_LOCALE = 'en';

/**
 * Resolve a user-supplied locale tag (or null) to a known set of
 * translations. Accepts BCP-47-ish input ("es-MX", "EN_us"); only
 * the leading two letters are honored. Unknown or empty input
 * yields the English default — security-critical emails must always
 * render, even if the user's stored language is corrupted.
 */
export function pickAccountLockoutLocale(
  locale: string | null | undefined,
): { code: string; strings: AccountLockoutStrings } {
  if (!locale || typeof locale !== 'string') {
    return { code: DEFAULT_ACCOUNT_LOCKOUT_LOCALE, strings: en };
  }
  const tag = locale.trim().toLowerCase().slice(0, 2);
  const strings = ACCOUNT_LOCKOUT_I18N[tag];
  if (strings) return { code: tag, strings };
  return { code: DEFAULT_ACCOUNT_LOCKOUT_LOCALE, strings: en };
}
