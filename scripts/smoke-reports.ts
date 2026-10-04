/**
 * Runs every report in the catalog against a real tenant database.
 *
 * The unit of trust here is not a test file - it is `tsc` plus this. A report
 * builder is an async function that composes a Prisma query and arithmetic; the
 * compiler cannot see that `sale.items.productId` needs a lookup map, and a
 * screen cannot show a query that throws only for one report out of eighty. So
 * this walks the whole catalog and prints anything that goes wrong - together
 * with how many rows each answer held, because a report that quietly returns
 * nothing (a wrong join, a filter that matches nothing) is the failure a
 * compiler will never catch.
 *
 * The window is chosen from the data rather than from today: the newest row in
 * the database is the anchor, so a tenant whose data is a few months old still
 * gets reports that return something.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/smoke-reports.ts [--pdf]
 *
 * DATABASE_URL selects the database (override with REPORT_DB_URL). Read-only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/tenant";
import { REPORT_CATALOG, UNAVAILABLE_REPORTS } from "@/lib/reports/catalog";
import { runReport } from "@/lib/reports/run";
import { renderReportPdf } from "@/lib/reports/pdf";
import { resolveValue } from "@/lib/i18n/resolve";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { MAX_RANGE_DAYS } from "@/lib/reports/period";
import type { TenantSession } from "@/lib/auth";
import type { Locale } from "@/lib/i18n/locale";

const OUT_DIR = path.join(process.cwd(), ".report-smoke");

function sessionFor(language: Locale, storeId: number | null): TenantSession {
  return {
    kind: "tenant",
    userId: 1,
    companyId: 1,
    storeId,
    role: storeId === null ? "company_admin" : "store_manager",
    email: "smoke@example.com",
    name: "Smoke test",
    language,
  };
}

/** A report must not be able to answer with a raw dictionary key: the screen
 *  would render the key and the PDF would render nothing. */
function unresolvedKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  const dictionary = getDictionary("en");
  if (typeof value === "string" && value.startsWith("reports.")) {
    if (resolveValue(dictionary, value as never) === undefined) out.add(value);
  }
  if (Array.isArray(value)) for (const item of value) unresolvedKeys(item, out);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) unresolvedKeys(item, out);
  }
  return out;
}

function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function main() {
  const wantsPdf = process.argv.includes("--pdf");
  if (wantsPdf) mkdirSync(OUT_DIR, { recursive: true });
  if (process.env.REPORT_DB_URL) process.env.DATABASE_URL = process.env.REPORT_DB_URL;

  const prisma = new PrismaClient();
  // The newest thing in the database decides the window: a tenant whose last
  // sale was months ago still has to be exercised with rows in it.
  const [newestSale, newestAudit] = await Promise.all([
    prisma.sale.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const anchor = newestSale?.createdAt ?? newestAudit?.createdAt ?? new Date();
  const day = 86_400_000;
  const failures: string[] = [];
  const warnings: string[] = [];
  const empty: string[] = [];
  const rowCounts: { key: string; rows: number; metrics: number; tiles: number }[] = [];
  let checked = 0;
  let refusals = 0;

  console.log(`Anchoring on ${anchor.toISOString().slice(0, 10)} (newest sale/audit row).`);

  for (const definition of REPORT_CATALOG) {
    // A report that caps its own window is asked only within that cap; the
    // refusal itself is covered by the route, not by walking past it.
    const spanDays = Math.min(definition.maxRangeDays ?? MAX_RANGE_DAYS, MAX_RANGE_DAYS);
    const window = {
      preset: "custom" as const,
      // Inclusive of both ends, so N days back is N-1 days before the anchor.
      from: dateKey(new Date(anchor.getTime() - (spanDays - 1) * day)),
      to: dateKey(anchor),
    };

    for (const scope of [null, 1] as (number | null)[]) {
      for (const language of ["en", "bn"] as Locale[]) {
        const label = `${definition.key} [${scope === null ? "all" : "store"} ${language}]`;
        try {
          const report = await runReport(prisma, sessionFor(language, scope), definition.key, window);
          checked += 1;
          for (const key of unresolvedKeys(report)) {
            warnings.push(`${label}: no dictionary entry for ${key}`);
          }
          if (language === "en" && scope === null) {
            // One line per report: the company-wide view in English.
            const tiles = (report.blocks ?? []).reduce((total, block) => total + block.items.length, 0);
            rowCounts.push({ key: definition.key, rows: report.rows.length, metrics: report.metrics.length, tiles });
            if (report.rows.length === 0 && report.metrics.every((metric) => metric.value === 0) && tiles === 0) {
              empty.push(definition.key);
            }
          }
          // `rows` is exactly `columns`, by construction of finish().
          for (const [index, row] of report.rows.entries()) {
            const extra = Object.keys(row).filter((key) => !report.columns.some((column) => column.key === key));
            if (extra.length > 0) {
              failures.push(`${label}: row ${index} carries ${extra.join(", ")}, which no column declares`);
              break;
            }
            for (const column of report.columns) {
              if (!(column.key in row)) {
                failures.push(`${label}: row ${index} is missing column "${column.key}"`);
                break;
              }
              const value = row[column.key];
              // Badge and key cells are the renderer's job to resolve. A dictionary key in
              // any other column is printed verbatim, so the user would read
              // `reports.something` instead of a word.
              if (
                typeof value === "string" &&
                value.startsWith("reports.") &&
                column.type !== "badge" &&
                column.type !== "key"
              ) {
                warnings.push(`${label}: column "${column.key}" shows the raw key ${value}`);
              }
            }
          }
          if (wantsPdf && scope === null) {
            const pdf = await renderReportPdf(report, language, {
              requestedBy: language === "bn" ? "স্মোক টেস্ট" : "Smoke test",
              scope: scope === null ? { kind: "all" } : { kind: "store", name: `Store ${scope}` },
            });
            const header = pdf.subarray(0, 5).toString("latin1");
            if (header !== "%PDF-") failures.push(`${label}: PDF did not start with %PDF- (got "${header}")`);
            else writeFileSync(path.join(OUT_DIR, `${definition.key}.${language}.pdf`), pdf);
          }
        } catch (error) {
          refusals += 1;
          failures.push(`${label}: ${(error as Error).message}`);
        }
      }
    }
  }

  await prisma.$disconnect();

  console.log(`\n${REPORT_CATALOG.length} reports (+${UNAVAILABLE_REPORTS.length} documented as unavailable).`);
  console.log(`${checked} runs completed, ${refusals} threw.`);
  console.log(
    `\nRows returned, widest window per report:\n${rowCounts
      .map((entry) => `  ${entry.key}: ${entry.rows} rows, ${entry.metrics} metrics, ${entry.tiles} tiles`)
      .join("\n")}`,
  );
  if (empty.length > 0) console.log(`\nNo rows in this database: ${empty.join(", ")}`);
  const dedupedWarnings = [...new Set(warnings)];
  if (dedupedWarnings.length > 0) {
    console.log(`\n${dedupedWarnings.length} dictionary warning(s):`);
    for (const warning of dedupedWarnings) console.log(`  ${warning}`);
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const failure of failures) console.log(`  ${failure}`);
    process.exit(1);
  }
  console.log("\nAll reports ran.");
  if (wantsPdf) console.log(`PDFs written to ${OUT_DIR}.`);
}

void main();