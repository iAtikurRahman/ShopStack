export const LOCALES = ["en", "bn"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Mirrors the account's saved `language` so the UI can be rendered in the
 * right language on a cold request - including on /login, where no session
 * exists yet. The API routes own this cookie; the client never writes it
 * directly, so the two can never disagree.
 */
export const LOCALE_COOKIE = "shopstack_locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  bn: "বাংলা",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Narrows a raw DB/cookie value to a supported locale. */
export function toLocale(value: string | null | undefined, fallback: Locale = DEFAULT_LOCALE): Locale {
  return isLocale(value) ? value : fallback;
}
