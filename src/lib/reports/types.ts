/**
 * The shape every report answers in.
 *
 * There are ~80 reports in the catalog and they are all rendered by one screen,
 * so they cannot each invent their own payload: a table, a row of headline
 * figures, and a period - that is the whole contract. `columns` is a fixed,
 * positional list rather than per-row keys so the renderer and the PDF builder
 * can both walk it without inspecting the data, and so a column can be right
 * aligned or formatted as money without the row having to say so.
 */

/** How a cell should be read, formatted and aligned. Drives both the on-screen
 *  table and the PDF, which is why it travels with the data instead of being
 *  guessed per report. */
export type ReportColumnType =
  | "text"
  /** The cell holds a dictionary key to be resolved, printed as ordinary text -
   *  the row name of a profit statement, a dashboard figure's name. `badge` is
   *  the same thing with a pill around it. */
  | "key"
  | "date"
  | "datetime"
  | "number"
  | "money"
  | "quantity"
  | "percent"
  | "badge";

export type ReportColumn = {
  /** Stable machine name, used as the row key and as the PDF's cell reference. */
  key: string;
  /** A dictionary key, not a literal: the routes answer in keys and the client
   *  resolves them, so one report definition serves both locales. */
  label: string;
  type: ReportColumnType;
  /** Totals row treatment for a numeric column. Off by default - a percentage
   *  column must never be summed, and a text column cannot be. */
  sum?: boolean;
  /** Right-align numerics; text stays left. Set by the renderer from `type`,
   *  so it only needs saying for the odd text column holding a number. */
  align?: "left" | "right";
};

export type ReportMetric = {
  key: string;
  label: string;
  /** A number, except for a `text` metric, which carries the word itself - the
   *  busiest hour of a day, say, which is not a quantity. */
  value: number | string;
  type: Exclude<ReportColumnType, "badge" | "date" | "datetime">;
  /** Renders in the warning colour - a negative profit, an over-count. */
  negative?: boolean;
};

/**
 * One cell.
 *
 * `boolean` is here for the yes/no badges (an account that is active, a return
 * line that was restocked) - the renderer prints them as such rather than as
 * "true", and the PDF builder needs to know not to right-align them.
 */
export type ReportCellValue = string | number | boolean | null;

export type ReportRow = Record<string, ReportCellValue>;

/**
 * A dashboard tile.
 *
 * The dashboard family has no table to draw - it is a wall of figures - so it
 * answers in blocks of tiles instead. A tile carries the window before it and the
 * change, because "revenue 412,000" means nothing until you can see what it was
 * before. Reports with a table leave `blocks` empty.
 */
export type ReportBlockItem = ReportMetric & {
  /** The same figure for the equally long window immediately before this one. */
  previous?: number;
  /** current - previous. */
  change?: number;
  /** change as a percentage of previous; 0 when previous was 0. */
  changeRate?: number;
  /** Dictionary key for a caveat that belongs to this tile alone. */
  note?: string;
};

export type ReportBlock = {
  /** Dictionary key for the group's heading. */
  title: string;
  items: ReportBlockItem[];
};

/** The ranges the picker offers. `custom` sends explicit from/to instead.
 *  Declared here rather than in period.ts so ReportPeriod does not have to
 *  import from the module that builds it. */
export const REPORT_PERIOD_PRESETS = [
  "today",
  "yesterday",
  "last7days",
  "last30days",
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
  "lastYear",
  "custom",
] as const;

export type ReportPeriodPreset = (typeof REPORT_PERIOD_PRESETS)[number];

export type ReportPeriod = {
  /** The preset the request asked for, echoed back so the UI can keep its
   *  picker in step even when the dates were clamped to something legal. */
  preset: ReportPeriodPreset;
  from: string;
  to: string;
  /** Inclusive start instant. */
  start: Date;
  /** Exclusive end instant. */
  end: Date;
};

export type ReportResult = {
  key: string;
  /** A dictionary key for the report's own title. */
  title: string;
  period: ReportPeriod;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Headline figures for the Summary tab. Always present, possibly empty. */
  metrics: ReportMetric[];
  /** Tile groups, for the dashboard family. Empty for a report with a table. */
  blocks?: ReportBlock[];
  /** Rendered under the table when a report needs to say something the columns
   *  cannot - which cost a profit uses, why a figure differs from the ledger. */
  notes?: string[];
  /** True when the answer was cut short, so the table can say "first N of many"
   *  rather than implying the list is complete. */
  truncated?: boolean;
  /** How many rows matched before any cap was applied. */
  totalRows?: number;
};

/** What a builder hands back before `finish()` applies the row cap. Kept here so
 *  the contract, the finished shape and the unfinished one sit together. */
export type ReportDraft = Omit<ReportResult, "rows" | "truncated" | "totalRows"> & {
  rows: ReportRow[];
};

/**
 * The nine groups the catalog is presented in. Also the sidebar's sections.
 * Lives here rather than in definition.ts because the client's catalog payload
 * names a family, and types.ts must not import definition.ts (that would be a
 * cycle: definition imports the draft and period types from here).
 */
export const REPORT_FAMILIES = [
  "dashboard",
  "sales",
  "inventory",
  "cash",
  "customers",
  "suppliers",
  "profit",
  "staff",
  "audit",
] as const;

export type ReportFamily = (typeof REPORT_FAMILIES)[number];

/** One entry in the picker. Metadata only - a builder is not serialisable. */
export type ReportCatalogEntry = {
  key: string;
  family: ReportFamily;
  title: string;
  description: string;
  /** Present when the report cannot answer for a long window; the screen uses
   *  it to offer only the periods that fit. */
  maxRangeDays?: number;
};

/** A report that was asked for and cannot be built from this schema. */
export type UnavailableReport = {
  key: string;
  family: ReportFamily;
  title: string;
  reason: string;
};

/**
 * What /api/store/reports/catalog answers with.
 *
 * Typed on both sides on purpose: the screen and the route cannot then disagree
 * about, say, whether `scope.storeId` is there, because adding a field to one
 * without the other is a compile error rather than an undefined in the browser.
 */
import type { ReportLetterhead } from "./letterhead";

export type ReportCatalogResponse = {
  presets: ReportPeriodPreset[];
  families: { family: ReportFamily; reports: ReportCatalogEntry[] }[];
  unavailable: UnavailableReport[];
  count: number;
  limits: { maxRangeDays: number; maxRows: number };
  /** Whether the caller's figures cover one store or all of them. */
  scope: { storeId: number | null; allStores: boolean };
/** The letterhead the screen prints from, so paper needs no second page. */
  letterhead: ReportLetterhead;
  /** Who asked for the report - the line the print sheet signs off with. */
  viewer: { name: string };
};

/** Thrown for a request the report cannot answer - an unknown key, a period
 *  that is not a real date. Carries the HTTP status so the route can map it. */
export class ReportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}