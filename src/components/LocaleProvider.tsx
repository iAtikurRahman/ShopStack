"use client";

import { createContext, useContext, useMemo, useEffect, type ReactNode } from "react";
import type { Dictionary, TranslationKey } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { interpolate } from "@/lib/i18n/interpolate";
import { lookupServerMessage, resolveValue, translateEnum } from "@/lib/i18n/resolve";
import { setActiveDictionary } from "@/lib/i18n/active-dictionary";
import { createFormatters, type Formatters } from "@/lib/i18n/format";

type I18nContextValue = {
  locale: Locale;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  /** Translates a raw DB enum value (status, role, payment method). */
  tEnum: (value: string) => string;
  /** Money, quantities, percentages and dates in the active locale. */
  fmt: Formatters;
  /**
   * Translates a message that came from the API. The routes answer in English,
   * so the lookup happens on the client where the chosen locale is known.
   */
  localize: (message: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  // Lets non-React callers (the apiFetch wrapper) reach the active locale.
  useEffect(() => setActiveDictionary(dictionary), [dictionary]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key, vars) => interpolate(resolveValue(dictionary, key) ?? key, vars),
      tEnum: (enumValue) => translateEnum(dictionary, enumValue),
      fmt: createFormatters(locale),
      localize: (message) => lookupServerMessage(dictionary, message),
    }),
    [dictionary, locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    // Only reachable if a client component is rendered outside the root
    // layout, where the dictionary would silently be missing.
    return {
      locale: DEFAULT_LOCALE,
      t: (key) => key,
      tEnum: (enumValue) => enumValue,
      fmt: createFormatters(DEFAULT_LOCALE),
      localize: (message) => message,
    };
  }
  return context;
}
