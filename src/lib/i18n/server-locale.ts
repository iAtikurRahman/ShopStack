import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, DEFAULT_LOCALE, toLocale, type Locale } from "./locale";

const LOCALE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The locale cookie is deliberately readable and long-lived: it is what makes
 * a cold request (including /login) render in the right language before any
 * session exists. The account row is the source of truth behind it.
 */
export async function setLocaleCookie(locale: Locale) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_TTL_MS / 1000,
  });
}

export async function readLocaleCookie(): Promise<Locale> {
  const store = await cookies();
  return toLocale(store.get(LOCALE_COOKIE)?.value, DEFAULT_LOCALE);
}
