/**
 * Shared preferred-language UI constants and helpers.
 *
 * Originally inlined in `profile-info-card.tsx` (#417); extracted in
 * task #420 so the set-password / accept-invite page can offer the
 * exact same dropdown to brand-new users BEFORE their first
 * onboarding email goes out. Anything that needs the same language
 * picker UX should import from here so adding a translation only
 * touches one client-side list (and one server-side bundle).
 *
 * Adding a new language: extend `LANGUAGE_OPTIONS` here and add a
 * matching entry to `server/services/email-i18n/password-changed.ts`
 * (which feeds `SUPPORTED_PREFERRED_LANGUAGES` on the API). The
 * intentional duplication keeps the dropdown self-contained on the
 * client and makes the round-trip easy to review.
 */

// Sentinel the Select uses for the "follow my browser" / unset
// option. shadcn's SelectItem disallows an empty `value`, so
// callers map this constant to `null` at the API-submit boundary.
export const LANGUAGE_AUTO = "__auto__";

export interface LanguageOption {
  value: string;
  label: string;
}

// Languages the backend understands today (mirrors the bundled
// translations in server/services/email-i18n/password-changed.ts).
export const LANGUAGE_OPTIONS: ReadonlyArray<LanguageOption> = [
  { value: "en", label: "English" },
  { value: "es", label: "Español (Spanish)" },
];

// Coerce a stored language code into one the dropdown can render.
// Defensive: pre-#417 the backend column accepted any string, so a
// legacy row could hold something we no longer ship a translation
// for ('fr', a typo, etc.). Treating those as "auto" prevents an
// otherwise-unrelated profile save from failing the new 400
// validation, and silently self-heals the row on the next save.
export function normalizeStoredLanguage(
  code: string | null | undefined,
): string {
  if (!code) return LANGUAGE_AUTO;
  return LANGUAGE_OPTIONS.some((o) => o.value === code) ? code : LANGUAGE_AUTO;
}

// Lookup label for the read-only display so the "currently saved"
// language pill matches the dropdown option's wording.
export function languageLabelFor(code: string | null | undefined): string {
  const normalized = normalizeStoredLanguage(code);
  if (normalized === LANGUAGE_AUTO) return "Auto (follow my browser)";
  const opt = LANGUAGE_OPTIONS.find((o) => o.value === normalized);
  return opt?.label ?? normalized;
}

// Map the form sentinel back to the wire shape the API expects:
// `null` for "auto / no preference", a known locale code otherwise.
export function languageSelectionToWire(
  selection: string,
): string | null {
  return selection === LANGUAGE_AUTO ? null : selection;
}
