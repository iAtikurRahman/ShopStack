import {
  ReportError,
  REPORT_PERIOD_PRESETS,
  type ReportPeriod,
  type ReportPeriodPreset,
} from "./types";

export { REPORT_PERIOD_PRESETS };
export type { ReportPeriodPreset };

/**
 * Turning a request into two instants, and instants back into the calendar
 * buckets the reports group by.
 *
 * Everything here works in the SERVER's local time on purpose. A shop's "today"
 * is the day the owner is standing in, and a sale at 11pm belongs to that day -
 * bucketing on UTC (or on a stored string) would file it under tomorrow for
 * half the world and quietly move a day's takings. So: local midnight to local
 * midnight, and a yyyy-mm-dd key that is a calendar day rather than an instant.
 *
 * No raw SQL anywhere in this app, which rules out Prisma's
 * `DATE(createdAt)` group-by, so the bucketing is done in JS over the rows in
 * the window. That is one row per sale for a chart and is fine; the ceiling on
 * how far the time-series reports may reach lives in lib/reports.ts as
 * MAX_TREND_DAYS, the same number the dashboard chart uses.
 */

/** How far back one request may reach. Bounds the rows a single report reads. */
export const MAX_RANGE_DAYS = 400;

/** Rows a single report may return. Past this the answer is capped and says so. */
export const MAX_ROWS = 1000;

/** Most rows a detail listing may pull before it is trimmed. */
export const DETAIL_LIMIT = 500;

/**
 * The longest window each preset can possibly cover, in days.
 *
 * The screen uses this to offer only the presets a given report can answer:
 * "Sales - daily" buckets sales in memory and refuses anything past the trend
 * cap, so offering it "This year" would hand the user a refusal they could have
 * been spared. Calendar lengths vary (this month is 28 days in February, this
 * year is 366 in a leap year), so these are deliberately worst-case figures -
 * a preset shown is guaranteed to fit, and the server remains the authority.
 */
export const PRESET_MAX_DAYS: Record<ReportPeriodPreset, number> = {
  today: 1,
  yesterday: 1,
  last7days: 7,
  last30days: 30,
  thisMonth: 31,
  lastMonth: 31,
  thisQuarter: 92,
  thisYear: 366,
  lastYear: 366,
  custom: 400,
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local calendar day as yyyy-mm-dd - a day the owner recognises, not an instant. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** yyyy-mm-dd HH:00, the label an hourly report groups by. */
export function toHourKey(date: Date): string {
  return `${toDateKey(date)} ${pad(date.getHours())}:00`;
}

/** yyyy-mm for a monthly report. */
export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** yyyy for a yearly report. */
export function toYearKey(date: Date): string {
  return String(date.getFullYear());
}

/** ISO week start (Monday) as a yyyy-mm-dd key - the bucket for a weekly report. */
export function toWeekKey(date: Date): string {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() is 0 for Sunday; shift so Monday is the origin.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return toDateKey(start);
}

export type BucketKind = "day" | "week" | "month" | "year" | "hour";

export function bucketKey(date: Date, kind: BucketKind): string {
  switch (kind) {
    case "hour":
      return toHourKey(date);
    case "week":
      return toWeekKey(date);
    case "month":
      return toMonthKey(date);
    case "year":
      return toYearKey(date);
    case "day":
    default:
      return toDateKey(date);
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Resolves a yyyy-mm-dd key to local midnight, or null when the string is not a
 * real calendar date.
 *
 * The round-trip check is what rejects 2026-02-31: the Date constructor would
 * happily roll that forward to 2 March, and a report that silently answered a
 * different question than the one asked is worse than one that refuses.
 */
export function resolveDayBounds(key: string): { start: Date; end: Date } | null {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    return null;
  }
  return { start, end: addDays(start, 1) };
}

export type PeriodRequest = {
  preset: string | null | undefined;
  from?: string | null;
  to?: string | null;
};

/**
 * The window a request asks for, as an inclusive start and an exclusive end.
 *
 * Every preset resolves against "today" in server-local time, and a `custom`
 * range is validated the same way a day key is - an unparseable one is refused
 * rather than defaulted, because a report for the wrong fortnight is worse than
 * no report.
 */
export function resolvePeriod(request: PeriodRequest, now: Date = new Date()): ReportPeriod {
  // `now` is the caller's clock, so a caller comparing two windows (or a check
  // run against fixed data) sees "today" as it means it there, not as the
  // server reads it a second later.
  const today = startOfDay(now);
  const preset = (request.preset ?? "last30days") as ReportPeriodPreset;

  let start: Date;
  let end: Date;

  switch (preset) {
    case "today":
      start = today;
      end = addDays(today, 1);
      break;
    case "yesterday":
      start = addDays(today, -1);
      end = today;
      break;
    case "last7days":
      start = addDays(today, -6);
      end = addDays(today, 1);
      break;
    case "last30days":
      start = addDays(today, -29);
      end = addDays(today, 1);
      break;
    case "thisMonth":
      start = startOfMonth(today);
      end = addDays(today, 1);
      break;
    case "lastMonth": {
      const thisMonth = startOfMonth(today);
      start = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1);
      end = thisMonth;
      break;
    }
    case "thisQuarter": {
      const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
      start = new Date(today.getFullYear(), quarterStartMonth, 1);
      end = addDays(today, 1);
      break;
    }
    case "thisYear":
      start = new Date(today.getFullYear(), 0, 1);
      end = addDays(today, 1);
      break;
    case "lastYear":
      start = new Date(today.getFullYear() - 1, 0, 1);
      end = new Date(today.getFullYear(), 0, 1);
      break;
    case "custom": {
      const fromBounds = request.from ? resolveDayBounds(request.from) : null;
      const toBounds = request.to ? resolveDayBounds(request.to) : null;
      if (!fromBounds || !toBounds) {
        throw new ReportError(400, "A custom period needs a valid from and to date");
      }
      start = fromBounds.start;
      // `to` is inclusive on the picker, so the window runs to the next midnight.
      end = toBounds.end;
      if (end <= start) {
        throw new ReportError(400, "The period ends before it starts");
      }
      break;
    }
    default:
      throw new ReportError(400, `Unknown period "${preset}"`);
  }

  const spanDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
  if (spanDays > MAX_RANGE_DAYS) {
    throw new ReportError(400, `A report cannot span more than ${MAX_RANGE_DAYS} days`);
  }

  return { preset, from: toDateKey(start), to: toDateKey(new Date(end.getTime() - 1)), start, end };
}

/** The window immediately before this one, of the same length - what the
 *  dashboard compares "sales vs previous period" against. */
export function previousPeriod(period: ReportPeriod): { start: Date; end: Date } {
  const span = period.end.getTime() - period.start.getTime();
  return { start: new Date(period.start.getTime() - span), end: new Date(period.start) };
}

/** Same window shifted back or forward by whole periods, so a daily trend can
 *  be read as "the same N days last month". */
export function shiftPeriod(
  period: ReportPeriod,
  unit: "day" | "week" | "month" | "year",
  amount: number
): { start: Date; end: Date } {
  const move = (date: Date): Date => {
    const next = new Date(date);
    if (unit === "day") next.setDate(next.getDate() + amount);
    if (unit === "week") next.setDate(next.getDate() + amount * 7);
    if (unit === "month") next.setMonth(next.getMonth() + amount);
    if (unit === "year") next.setFullYear(next.getFullYear() + amount);
    return next;
  };
  return { start: move(period.start), end: move(period.end) };
}

/** Inclusive-start/exclusive-end filter for a Prisma `where`. */
export function withinPeriod(period: ReportPeriod): { gte: Date; lt: Date } {
  return { gte: period.start, lt: period.end };
}

/**
 * Whether an instant falls in the window. Used by the movement-ledger reports,
 * which union several tables and filter in JS rather than issuing one filtered
 * query per source.
 */
export function inPeriod(date: Date, period: ReportPeriod): boolean {
  const time = date.getTime();
  return time >= period.start.getTime() && time < period.end.getTime();
}