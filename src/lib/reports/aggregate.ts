import { round2 } from "@/lib/returns";
import { MAX_ROWS } from "./period";
import type { ReportColumn, ReportDraft, ReportResult, ReportRow } from "./types";

/**
 * The arithmetic every report needs, in one place.
 *
 * The point is not cleverness, it is consistency: money is rounded at the same
 * step in all ~60 reports (so two reports of the same sale never disagree by a
 * paisa), percentages are computed the same way (so a margin column and a
 * margin summary can never tell different stories), and every table is trimmed
 * and labelled through the same helper (so "showing first 1000 of 4210" is
 * worded the same everywhere).
 */

/** Prisma hands Decimal columns back as an object; the client only wants a number. */
export type DecimalLike = string | number | { toString(): string };

/** Coerces a Decimal, a numeric string or nothing at all to a finite number.
 *  Deliberately does NOT round - rounding here would quietly truncate a margin
 *  rate or a unit cost to two decimals on its way through. Rounding happens once,
 *  at the point a figure is displayed (round2) or summed (add). */
export function num(value: DecimalLike | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(typeof value === "object" ? value.toString() : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Money addition. Rounds as it goes, which is what a shop's ledger does: every
 *  running total is the rounded total, never the exact sum of unrounded parts. */
export function add(...values: DecimalLike[]): number {
  return round2(values.reduce<number>((sum, value) => sum + num(value), 0));
}

/** Share of a total as a percentage. A divide by zero is "no margin", not a
 *  broken cell, so it answers 0 rather than NaN. */
export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return round2((part / whole) * 100);
}

export type SortDirection = "asc" | "desc";

/**
 * Sorts rows by a column key, numbers numerically and everything else as text.
 * Nulls sort last in both directions - a row with nothing in the column belongs
 * at the bottom of a report, not at the top of it.
 */
export function sortRows(
  rows: ReportRow[],
  key: string,
  direction: SortDirection = "desc"
): ReportRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
    if (right === null || right === undefined) return -1;
    if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
    return String(left).localeCompare(String(right)) * factor;
  });
}

/** Trims a table to MAX_ROWS and records that it did, so the UI can say how many
 *  were left out instead of quietly showing a partial answer as a whole one. */
export function capRows(rows: ReportRow[]): { rows: ReportRow[]; truncated: boolean; total: number } {
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS, total: rows.length };
}

/** Finishes a report: applies the cap, records the real row count, and hands
 *  back the shape the route serialises. Every builder returns through here so
 *  no report can forget the bookkeeping.
 *
 *  It also trims each row to the keys its columns declare. Builders often carry
 *  a raw id along - a productId to sort by before the rows are sorted, a userId
 *  to resolve a name from - and leaving those in the payload would mean the wire
 *  shape quietly depended on how a builder happened to be written. Doing it once
 *  here means `rows` is always exactly `columns`, and a renderer can walk the two
 *  together without wondering whether a stray key matters. */
export function finish(draft: ReportDraft): ReportResult {
  const keys = draft.columns.map((column) => column.key);
  const rows = draft.rows.map((row) => {
    const trimmed: ReportRow = {};
    for (const key of keys) {
      if (key in row) trimmed[key] = row[key];
    }
    return trimmed;
  });
  const capped = capRows(rows);
  return { ...draft, rows: capped.rows, truncated: capped.truncated, totalRows: capped.total };
}

/** Column defs for the same table twice, under two label sets - which is what
 *  "sales" and "sales by customer" need when only the grouping column differs. */
export function columns(...defs: ReportColumn[]): ReportColumn[] {
  return defs;
}