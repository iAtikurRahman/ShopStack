import { readFileSync } from "node:fs";
import path from "node:path";
import pdfMake, { type PdfContent, type PdfDocument, type PdfTableCell } from "pdfmake/js";
import { getDictionary, translate, type Dictionary } from "@/lib/i18n/dictionaries";
import { createFormatters, type Formatters } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import type { ReportBlock, ReportColumn, ReportResult, ReportRow } from "./types";
import { letterheadLines, type ReportLetterhead } from "./letterhead";

/**
 * Turning a finished report into a PDF.
 *
 * Server-side on purpose, and it goes through the same `runReport` the JSON
 * route does, so the download can never disagree with the screen. It also means
 * a 1000-row table does not have to travel through the browser before a single
 * byte of PDF is produced.
 *
 * The font is the other reason. pdfmake's built-in Roboto has no Bengali
 * glyphs, and this app's second language is Bengali - so the document embeds
 * Noto Sans Bengali (OFL, see assets/fonts/LICENSE.txt), which carries both
 * scripts. One family for both means no "missing text" reports in Bangla.
 */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT_NAME = "Roboto"; // the family name inside the document; the file is Noto
const REGULAR = "NotoSansBengali-Regular.ttf";
const SEMIBOLD = "NotoSansBengali-SemiBold.ttf";

let fontsReady = false;

/**
 * Registers the font once per process. The files go into pdfmake's virtual
 * filesystem rather than into the document definition, and the local-access
 * policy is closed so a document definition can never read a file off the
 * server - only the two font files registered here are reachable.
 */
function ensureFonts(): void {
  if (fontsReady) return;
  pdfMake.virtualfs.writeFileSync(REGULAR, readFileSync(path.join(FONT_DIR, REGULAR)));
  pdfMake.virtualfs.writeFileSync(SEMIBOLD, readFileSync(path.join(FONT_DIR, SEMIBOLD)));
  pdfMake.setLocalAccessPolicy(() => false);
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.addFonts({
    [FONT_NAME]: {
      normal: REGULAR,
      bold: SEMIBOLD,
      italics: REGULAR,
      bolditalics: SEMIBOLD,
    },
  });
  fontsReady = true;
}

export type PdfMeta = {
  /** Who asked for it, printed in the header. */
  requestedBy: string;
  /** Whether the figures cover one store or all of them. Translated here, so
   *  the route does not have to know the label. */
  scope: { kind: "all" } | { kind: "store"; name: string };
  /** The same letterhead the print page opens with, so the downloaded file and
   *  the printout carry the same shop's name, address and logo. */
  letterhead: ReportLetterhead;
};

/** One cell, formatted the way its column says it should be read. */
function cell(
  value: ReportRow[string],
  column: ReportColumn,
  fmt: Formatters,
  t: (key: string) => string
): string {
  if (value === null || value === undefined) return "—";
  // Badges are the one place a bare boolean is meaningful, so it is answered in
  // the report's own language rather than as "true".
  const yesNo = (flag: boolean) => (flag ? t("common.yes") : t("common.no"));
  switch (column.type) {
    case "money":
      return fmt.money(value);
    case "quantity":
      return fmt.quantity(value);
    case "percent":
      return fmt.percent(value);
    case "number":
      return fmt.number(value);
    case "date":
      return fmt.date(String(value));
    case "datetime":
      return fmt.dateTime(String(value));
    case "badge":
      return typeof value === "boolean" ? yesNo(value) : t(String(value));
    case "key":
      // A dictionary key, so it is resolved rather than printed. An unknown key
      // comes back unchanged, which is how a raw enum still reads as itself.
      return typeof value === "boolean" ? yesNo(value) : t(String(value));
    case "text":
    default:
      return typeof value === "boolean" ? yesNo(value) : String(value);
  }
}

/** The totals line, only for the columns a report marked as summable. */
function totalsRow(report: ReportResult, fmt: Formatters, t: (key: string) => string): PdfTableCell[] | null {
  const sums = (column: ReportColumn) => Boolean(column.sum) && column.type !== "percent";
  if (!report.columns.some(sums)) return null;
  return report.columns.map((column, index) => {
    const blank = { bold: true, fillColor: "#f1f5f9" };
    // The label goes in the first column so the line reads "Total …" rather
    // than starting with an empty cell.
    if (index === 0) return { ...blank, text: t("common.total") };
    if (!sums(column)) return { ...blank, text: "" };
    const total = report.rows.reduce((sum, row) => {
      const value = row[column.key];
      return typeof value === "number" ? sum + value : sum;
    }, 0);
    const formatted =
      column.type === "quantity"
        ? fmt.quantity(total)
        : column.type === "number"
          ? fmt.number(total)
          : fmt.money(total);
    return { text: formatted, bold: true, alignment: "right" as const, fillColor: "#f1f5f9" };
  });
}

/** The table, with the header repeated on every page pdfmake breaks it over. */
function table(report: ReportResult, t: (key: string) => string, fmt: Formatters): PdfContent {
  if (report.columns.length === 0 || report.rows.length === 0) return [];
  const header: PdfTableCell[] = report.columns.map((column) => ({
    text: t(column.label),
    bold: true,
    fillColor: "#0f172a",
    color: "#ffffff",
    fontSize: 8,
    alignment: isNumeric(column) ? ("right" as const) : ("left" as const),
  }));
  const body: PdfTableCell[][] = report.rows.map((row) =>
    report.columns.map((column) => ({
      text: cell(row[column.key], column, fmt, t),
      fontSize: 8,
      alignment: isNumeric(column) ? ("right" as const) : ("left" as const),
    }))
  );
  const totals = totalsRow(report, fmt, t);
  return {
    headerRows: 1,
    table: {
      headerRows: 1,
      widths: report.columns.map(() => "auto"),
      body: totals ? [header, ...body, totals] : [header, ...body],
    },
    margin: [0, 6, 0, 0],
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => "#e2e8f0",
      vLineColor: () => "#e2e8f0",
    },
    fontSize: 8,
  } as unknown as PdfContent;
}

function isNumeric(column: ReportColumn): boolean {
  return column.type === "money" || column.type === "number" || column.type === "quantity" || column.type === "percent";
}

/** The dashboard tiles, as a compact two-column table per block. */
function blocks(groups: ReportBlock[], t: (key: string) => string, fmt: Formatters): PdfContent[] {
  const out: PdfContent[] = [];
  for (const group of groups) {
    const rows: PdfTableCell[][] = [];
    for (const item of group.items) {
      const formatted =
        item.type === "money"
          ? fmt.money(item.value)
          : item.type === "percent"
            ? fmt.percent(item.value)
            : item.type === "quantity"
              ? fmt.quantity(item.value)
              : fmt.number(item.value);
      const previous =
        item.previous === undefined
          ? null
          : item.type === "money"
            ? fmt.money(item.previous)
            : item.type === "percent"
              ? fmt.percent(item.previous)
              : fmt.number(item.previous);
      const change = item.change === undefined ? null : `${item.change > 0 ? "+" : ""}${fmt.number(item.change)}`;
      rows.push([
        { text: t(item.label), fontSize: 9 },
        { text: formatted, fontSize: 9, bold: true, alignment: "right", color: item.negative ? "#b91c1c" : undefined },
        { text: previous ?? "—", fontSize: 8, alignment: "right", color: "#64748b" },
        { text: change ?? "—", fontSize: 8, alignment: "right", color: "#64748b" },
      ]);
    }
    out.push({ text: t(group.title), fontSize: 11, bold: true, margin: [0, 8, 0, 4] });
    out.push({
      table: {
        widths: ["*", "auto", "auto", "auto"],
        body: [
          [
            { text: t("reports.col.stat"), fontSize: 8, bold: true, fillColor: "#f1f5f9" },
            { text: t("reports.col.value"), fontSize: 8, bold: true, alignment: "right", fillColor: "#f1f5f9" },
            { text: t("reports.col.previousWindow"), fontSize: 8, bold: true, alignment: "right", fillColor: "#f1f5f9" },
            { text: t("reports.col.change"), fontSize: 8, bold: true, alignment: "right", fillColor: "#f1f5f9" },
          ],
          ...rows,
        ],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => "#e2e8f0",
        vLineColor: () => "#e2e8f0",
      },
      margin: [0, 0, 0, 8],
      fontSize: 8,
    } as unknown as PdfContent);
  }
  return out;
}

/** The store's picture as a data URI, or null when it is missing or unreadable. */
function readLogoData(imageUrl: string): string | null {
  // imageUrl is a public path (`/uploads/company-1/stores/x.png`); anything
  // else is not ours to read.
  if (!imageUrl.startsWith("/uploads/")) return null;
  const file = path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
  try {
    const bytes = readFileSync(file);
    const extension = path.extname(file).toLowerCase();
    const mime = extension === ".png" ? "image/png" : extension === ".gif" ? "image/gif" : "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * The head of the document, read top to bottom like a bill: which report this
 * is, then whose figures they are - the shop's picture, the shop's name, where
 * the shop is - and only then the table. Stacked rather than side by side so a
 * long Bengali shop name or address gets the full page width, and the same
 * order the print view draws.
 *
 * The logo is read off disk rather than fetched, because local-access and URL
 * access are both closed for the document definition; a missing or unreadable
 * file simply leaves the text below it, which is still a usable letterhead.
 */
function letterheadBlock(
  report: ReportResult,
  meta: PdfMeta,
  t: (key: string, vars?: Record<string, string | number>) => string
): PdfContent {
  const { letterhead } = meta;
  const { heading, contact } = letterheadLines(letterhead, { allStores: t("reports.ui.allStores") });

  const stack: PdfContent[] = [
    { text: t(report.title), fontSize: 15, bold: true, alignment: "center", color: "#0f172a" },
    {
      text: `${t("reports.ui.periodLabel")}: ${report.period.from} → ${report.period.to}`,
      fontSize: 9,
      alignment: "center",
      color: "#475569",
      margin: [0, 2, 0, 0],
    },
  ];

  if (letterhead.imageUrl) {
    const logo = readLogoData(letterhead.imageUrl);
    if (logo) stack.push({ image: logo, width: 62, alignment: "center", margin: [0, 8, 0, 0] } as PdfContent);
  }

  stack.push({ text: heading, fontSize: 14, bold: true, alignment: "center", color: "#0f172a", margin: [0, 6, 0, 0] });
  if (contact) {
    stack.push({ text: contact, fontSize: 9, alignment: "center", color: "#475569", margin: [0, 2, 0, 0] });
  }

  // One centred column between two rules: a ruled header like a bill's, with no
  // vertical lines to cut through a long address.
  return {
    table: { widths: ["*"], body: [[{ stack }]] },
    layout: {
      hLineWidth: (row: number) => (row === 0 || row === 1 ? 1.5 : 0),
      vLineWidth: () => 0,
      paddingTop: () => 8,
      paddingBottom: () => 8,
      paddingLeft: () => 6,
      paddingRight: () => 6,
    },
    margin: [0, 0, 0, 10],
  } as unknown as PdfContent;
}

/** Builds the document. Exported so it can be inspected without rendering. */
export function reportDocument(report: ReportResult, locale: Locale, meta: PdfMeta): PdfDocument {
  const dictionary: Dictionary = getDictionary(locale);
  const fmt = createFormatters(locale);
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(dictionary, key as Parameters<typeof translate>[1], vars);

  // The table is the report; the headline figures stay on the screen, where they
  // help, and off the page, where they only crowd the rows being read.
  const content: PdfContent[] = [letterheadBlock(report, meta, t)];

  if (report.blocks && report.blocks.length > 0) {
    content.push(...blocks(report.blocks, t, fmt));
  }

  const grid = table(report, t, fmt);
  if (Array.isArray(grid) ? grid.length > 0 : Boolean(grid)) content.push(grid);

  if (report.rows.length === 0) {
    content.push({ text: t("reports.ui.noRows"), fontSize: 10, color: "#64748b", margin: [0, 8, 0, 0] });
  }
  if (report.truncated) {
    content.push({
      text: t("reports.ui.truncatedPdf", { shown: report.rows.length, total: report.totalRows ?? 0 }),
      fontSize: 8,
      color: "#b45309",
      margin: [0, 6, 0, 0],
    });
  }

  // Who printed it is a signature, not a heading: it belongs under everything,
  // on the left, the way it is signed on a bill. A table rather than a rule drawn
  // by hand, so the line spans the page in either orientation.
  content.push({
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: t("reports.ui.printedBy", { name: meta.requestedBy }),
            fontSize: 8,
            alignment: "left",
            color: "#64748b",
          },
        ],
      ],
    },
    layout: {
      hLineWidth: (row: number) => (row === 0 ? 0.5 : 0),
      vLineWidth: () => 0,
      paddingTop: () => 6,
      paddingBottom: () => 0,
    },
    margin: [0, 10, 0, 0],
  } as unknown as PdfContent);

  return {
    content,
    defaultStyle: { font: FONT_NAME, fontSize: 9 },
    pageSize: "A4",
    // Wide tables (a movement ledger, an audit diff) need the room.
    pageOrientation: report.columns.length > 7 ? "landscape" : "portrait",
    pageMargins: [28, 32, 28, 40],
    // The footer is handed the current page, so the page number is read from it
  // rather than left as an unevaluated expression inside a string - pdfmake only
  // evaluates a `text` that *is* a function.
  footer: (currentPage): PdfContent => ({
    columns: [
      {
        text: t("reports.ui.generatedAt", { at: fmt.dateTime(new Date().toISOString()) }),
        fontSize: 7,
        color: "#94a3b8",
      },
      {
        text: `${t("reports.ui.page")} ${currentPage.pageNumber}/${currentPage.pageCount}`,
        fontSize: 7,
        color: "#94a3b8",
        alignment: "right" as const,
      },
    ],
    margin: [28, 8, 28, 0],
  }),
    info: { title: t(report.title), creator: "ShopStack" },
  };
}

/** Renders the document to bytes. */
export async function renderReportPdf(
  report: ReportResult,
  locale: Locale,
  meta: PdfMeta
): Promise<Buffer> {
  ensureFonts();
  return pdfMake.createPdf(reportDocument(report, locale, meta)).getBuffer();
}

/** A filename that sorts sensibly and says what it is: shopstack-sales-daily-2026-04-01.pdf */
export function pdfFilename(report: ReportResult): string {
  const slug = report.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `shopstack-${slug}-${report.period.from}.pdf`;
}