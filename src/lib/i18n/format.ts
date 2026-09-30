import type { Locale } from "./locale";

/**
 * Money, quantities, percentages and dates follow the active locale: with
 * Bangla selected they render in Bengali digits ("৳১,২৩৪.৫৬", "১২ মার্চ,
 * ২০২৬"), with English they stay exactly as they did before.
 *
 * Note this is display only. Form inputs keep Latin digits so typing, parsing
 * and the API payloads are unaffected.
 */
const TAG: Record<Locale, string> = { en: "en-US", bn: "bn-BD" };
const CURRENCY = "৳";
const MISSING = "—";

export type NumberFormatOptions = {
  /** Fixed fraction digits, e.g. 2 for money. */
  decimals?: number;
  /** Upper bound when trailing zeros should be dropped, e.g. quantities. */
  maxDecimals?: number;
};

export type Formatters = {
  /** "৳1,234.50" / "৳১,২৩৪.৫০" - two decimals unless told otherwise. */
  money: (value: unknown, options?: NumberFormatOptions) => string;
  number: (value: unknown, options?: NumberFormatOptions) => string;
  /** Quantities may be fractional, so trailing zeros are dropped. */
  quantity: (value: unknown) => string;
  /** The value is already in percent units (15 -> "15%"). */
  percent: (value: unknown) => string;
  date: (value: string | number | Date | null | undefined) => string;
  dateTime: (value: string | number | Date | null | undefined) => string;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // Prisma hands Decimal columns back as strings.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Maps Bengali digits ("১২৩.৫০") back to Latin so an editable field can show
 * Bangla digits yet still submit/parse a plain number.
 */
export function toLatinNumber(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0);
    out += code !== undefined && code >= 0x09e6 && code <= 0x09ef ? String(code - 0x09e6) : ch;
  }
  return out;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(TAG[locale], options);
    numberFormats.set(key, format);
  }
  return format;
}

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(TAG[locale], options);
    dateFormats.set(key, format);
  }
  return format;
}

export function createFormatters(locale: Locale): Formatters {
  const money: Formatters["money"] = (value, options) => {
    const amount = toNumber(value);
    if (amount === null) return MISSING;
    const decimals = options?.decimals ?? 2;
    const formatted = numberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
    return `${CURRENCY}${formatted}`;
  };

  const numeric: Formatters["number"] = (value, options) => {
    const amount = toNumber(value);
    if (amount === null) return MISSING;
    return numberFormat(locale, {
      minimumFractionDigits: options?.decimals ?? 0,
      maximumFractionDigits: options?.maxDecimals ?? options?.decimals ?? 2,
    }).format(amount);
  };

  const date: Formatters["date"] = (value) => {
    const parsed = toDate(value);
    if (!parsed) return MISSING;
    // Full month names in both locales ("২৯ সেপ্টেম্বর, ২০২৬" / "29 September
    // 2026"). dateStyle:"medium" shortens to "সেপ" in some browser ICU builds.
    return dateFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(parsed);
  };

  const dateTime: Formatters["dateTime"] = (value) => {
    const parsed = toDate(value);
    if (!parsed) return MISSING;
    return dateFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      ...(locale === "bn" ? { hour12: false } : {}),
    }).format(parsed);
  };

  return {
    money,
    number: numeric,
    quantity: (value) => numeric(value, { maxDecimals: 2 }),
    percent: (value) => {
      const amount = toNumber(value);
      return amount === null ? MISSING : `${numeric(amount, { maxDecimals: 2 })}%`;
    },
    date,
    dateTime,
  };
}
