import type { Locale } from "./i18n/locale";

/**
 * The unit-of-measure catalog.
 *
 * A product is kept in exactly one "stock unit" (Product.unit). Every unit
 * belongs to a family (mass, volume, count) and, inside a family, converts to
 * the family's base unit by a fixed factor. A purchase or sale line may be
 * entered in any unit of the product's family; the quantity is converted to the
 * stock unit before it ever reaches inventory, so stock arithmetic always works
 * in one unit per product while the paperwork keeps whatever the user typed.
 *
 * `box` and `pack` are count units whose size depends on the product itself, so
 * their factor comes from Product.unitValue (pieces per box/pack) at call time
 * rather than being a constant. When a product does not declare one they fall
 * back to a factor of 1.
 */
export type UnitFamily = "mass" | "volume" | "count";

export type UnitCode =
  | "g"
  | "kg"
  | "mon"
  | "ml"
  | "litre"
  | "piece"
  | "dozen"
  | "box"
  | "pack";

export type UnitDef = {
  code: UnitCode;
  family: UnitFamily;
  /** Multiply a value in this unit by this to get the family base unit. */
  factor: number;
  /** True when `factor` is only a fallback and Product.unitValue should win. */
  productSized: boolean;
  en: string;
  bn: string;
};

export const DEFAULT_UNIT: UnitCode = "piece";

export const UNITS: UnitDef[] = [
  { code: "piece", family: "count", factor: 1, productSized: false, en: "pc", bn: "পিস" },
  { code: "dozen", family: "count", factor: 12, productSized: false, en: "dozen", bn: "ডজন" },
  { code: "box", family: "count", factor: 1, productSized: true, en: "box", bn: "বক্স" },
  { code: "pack", family: "count", factor: 1, productSized: true, en: "pack", bn: "প্যাক" },
  { code: "g", family: "mass", factor: 1, productSized: false, en: "g", bn: "গ্রাম" },
  { code: "kg", family: "mass", factor: 1000, productSized: false, en: "kg", bn: "কেজি" },
  { code: "mon", family: "mass", factor: 40000, productSized: false, en: "mon", bn: "মন" },
  { code: "ml", family: "volume", factor: 1, productSized: false, en: "ml", bn: "মিলি" },
  { code: "litre", family: "volume", factor: 1000, productSized: false, en: "L", bn: "লিটার" },
];

const BY_CODE = new Map(UNITS.map((u) => [u.code, u]));

// Spoken/typed variants the shop is likely to send (the old picker used
// "liter"; users type "pcs", "gm", "ltr").
const ALIASES: Record<string, UnitCode> = {
  pc: "piece",
  pcs: "piece",
  pieces: "piece",
  p: "piece",
  dz: "dozen",
  gram: "g",
  grams: "g",
  gm: "g",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  monn: "mon",
  maund: "mon",
  liter: "litre",
  liters: "litre",
  ltr: "litre",
  l: "litre",
  mls: "ml",
  boxes: "box",
  packs: "pack",
  packet: "pack",
  packets: "pack",
};

export function normalizeUnit(value: string | null | undefined): UnitCode {
  if (!value) return DEFAULT_UNIT;
  const key = value.trim().toLowerCase();
  if (BY_CODE.has(key as UnitCode)) return key as UnitCode;
  return ALIASES[key] ?? DEFAULT_UNIT;
}

export function resolveUnit(value: string | null | undefined): UnitDef {
  return BY_CODE.get(normalizeUnit(value)) ?? BY_CODE.get(DEFAULT_UNIT)!;
}

export function unitFamilyOf(value: string | null | undefined): UnitFamily {
  return resolveUnit(value).family;
}

export function isSameFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  return unitFamilyOf(a) === unitFamilyOf(b);
}

export function unitsInFamily(family: UnitFamily): UnitDef[] {
  return UNITS.filter((u) => u.family === family);
}

export function unitOptionsFor(stockUnit: string | null | undefined): UnitDef[] {
  return unitsInFamily(unitFamilyOf(stockUnit));
}

export function isKnownUnit(value: string | null | undefined): boolean {
  if (!value) return false;
  const key = value.trim().toLowerCase();
  return BY_CODE.has(key as UnitCode) || key in ALIASES;
}

/** The factor that converts one `unit` into the family base unit. */
function factorOf(value: string | null | undefined, packFactor?: number | null): number {
  const def = resolveUnit(value);
  if (def.productSized) {
    return packFactor && packFactor > 0 ? packFactor : def.factor;
  }
  return def.factor;
}

/**
 * Converts `value` from `from` to `to`. Returns null when the two units belong
 * to different families (kg can never become a litre) or when `value` is not a
 * finite number. The result is rounded to 2 decimals, matching how quantities
 * are stored (Decimal(14,2)) and displayed.
 */
export function convertQuantity(
  value: number,
  from: string | null | undefined,
  to: string | null | undefined,
  packFactor?: number | null
): number | null {
  if (!Number.isFinite(value)) return null;
  if (!isSameFamily(from, to)) return null;
  const inBase = value * factorOf(from, packFactor);
  const result = inBase / factorOf(to, packFactor);
  return roundQuantity(result);
}

/** Rounds a quantity to the 2 decimals the schema stores. */
export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** The display symbol for a unit in the active locale. */
export function unitLabel(value: string | null | undefined, locale: Locale): string {
  return resolveUnit(value)[locale];
}
