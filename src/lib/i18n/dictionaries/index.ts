import { en as common } from "./en/common";
import { en as nav } from "./en/nav";
import { en as auth } from "./en/auth";
import { en as storeOps } from "./en/storeOps";
import { en as storeCommerce } from "./en/storeCommerce";
import { en as company } from "./en/company";
import { en as admin } from "./en/admin";
import { en as reports } from "./en/reports";
import { bn as commonBn } from "./bn/common";
import { bn as navBn } from "./bn/nav";
import { bn as authBn } from "./bn/auth";
import { bn as storeOpsBn } from "./bn/storeOps";
import { bn as storeCommerceBn } from "./bn/storeCommerce";
import { bn as companyBn } from "./bn/company";
import { bn as adminBn } from "./bn/admin";
import { bn as reportsBn } from "./bn/reports";
import type { Locale } from "../locale";
import { interpolate } from "../interpolate";
import { resolveValue } from "../resolve";

/**
 * The English dictionary is the single source of truth for the key set and
 * its shape. `bn` is annotated as `Dictionary`, so a missing or misspelled
 * key fails the type check instead of silently falling back at runtime.
 */
const en = {
  ...common,
  ...nav,
  ...auth,
  ...storeOps,
  ...storeCommerce,
  ...company,
  ...admin,
  ...reports,
};

export type Dictionary = typeof en;

const bn: Dictionary = {
  ...commonBn,
  ...navBn,
  ...authBn,
  ...storeOpsBn,
  ...storeCommerceBn,
  ...companyBn,
  ...adminBn,
  ...reportsBn,
};

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

/** Dot-path key into the dictionary, e.g. "nav.dashboard". */
export type TranslationKey = Leaves<Dictionary>;

export function getDictionary(locale: Locale): Dictionary {
  return locale === "bn" ? bn : en;
}

/** Resolves a dot-path key; falls back to the English string, then the key. */
export function translate(
  dictionary: Dictionary,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  return interpolate(resolveValue(dictionary, key) ?? resolveValue(en, key) ?? key, vars);
}
