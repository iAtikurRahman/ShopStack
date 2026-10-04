import { auditReports } from "./families/audit";
import { cashReports } from "./families/cash";
import { customerReports } from "./families/customers";
import { dashboardReports } from "./families/dashboard";
import { inventoryReports } from "./families/inventory";
import { profitReports } from "./families/profit";
import { salesReports } from "./families/sales";
import { staffReports } from "./families/staff";
import { supplierReports } from "./families/suppliers";
import { type ReportDefinition, type ReportFamily } from "./definition";
import { ReportError } from "./types";

/**
 * The catalog: every report the app can produce, in one list.
 *
 * This is the whole point of the design. Nine families, ~60 builders, and every
 * one of them reachable through a single route and a single screen - so a new
 * report is one object in one of these arrays, not a new page, a new API file, a
 * new table component and a new PDF builder.
 *
 * The list is also the catalog the UI renders, so what the screen offers and what
 * the endpoint will actually run cannot drift apart.
 */

export const REPORT_CATALOG: ReportDefinition[] = [
  ...dashboardReports,
  ...salesReports,
  ...inventoryReports,
  ...cashReports,
  ...customerReports,
  ...supplierReports,
  ...profitReports,
  ...staffReports,
  ...auditReports,
];

/** Family order as the sidebar shows it, with the definitions each one owns. */
export function catalogByFamily(): { family: ReportFamily; reports: ReportDefinition[] }[] {
  const grouped = new Map<ReportFamily, ReportDefinition[]>();
  for (const report of REPORT_CATALOG) {
    const list = grouped.get(report.family) ?? [];
    list.push(report);
    grouped.set(report.family, list);
  }
  return [...grouped.entries()].map(([family, reports]) => ({ family, reports }));
}

const byKey = new Map(REPORT_CATALOG.map((report) => [report.key, report]));

/** The definition for a key, or a 404 for anything not in the catalog. The
 *  check is a map lookup rather than a filter over the list on every request,
 *  and an unknown key never reaches a builder. */
export function getReport(key: string): ReportDefinition {
  const report = byKey.get(key);
  if (!report) {
    throw new ReportError(404, `No report called "${key}"`);
  }
  return report;
}

export function reportExists(key: string): boolean {
  return byKey.has(key);
}

/**
 * Reports that were asked for and cannot be built from this schema.
 *
 * They are listed rather than quietly dropped, because a report screen that is
 * missing something the owner expected is worse than one that says why. Each
 * reason names the table that would have to exist.
 */
export const UNAVAILABLE_REPORTS: { key: string; family: ReportFamily; title: string; reason: string }[] = [
  {
    key: "login-history",
    family: "staff",
    title: "reports.report.loginHistory",
    reason: "reports.reason.noLoginTable",
  },
  {
    key: "failed-logins",
    family: "staff",
    title: "reports.report.failedLogins",
    reason: "reports.reason.noLoginTable",
  },
  {
    key: "user-login-activity",
    family: "staff",
    title: "reports.report.userLoginActivity",
    reason: "reports.reason.noLoginTable",
  },
  {
    key: "stock-adjustments",
    family: "audit",
    title: "reports.report.stockAdjustments",
    reason: "reports.reason.stockHasNoMovementTable",
  },
  {
    key: "physical-stock-count",
    family: "audit",
    title: "reports.report.physicalStockCount",
    reason: "reports.reason.stockHasNoMovementTable",
  },
  {
    key: "cash-short-over",
    family: "cash",
    title: "reports.report.cashShortOver",
    reason: "reports.reason.noCashSessionModel",
  },
  {
    key: "cashier-shift-opening-closing",
    family: "cash",
    title: "reports.report.cashierShift",
    reason: "reports.reason.noCashSessionModel",
  },
  {
    key: "discount-approval-history",
    family: "staff",
    title: "reports.report.discountApprovalHistory",
    reason: "reports.reason.noApprovalWorkflow",
  },
  {
    key: "batch-expiry",
    family: "inventory",
    title: "reports.report.batchExpiry",
    reason: "reports.reason.noBatchOrExpiryModel",
  },
  {
    key: "cancelled-invoices",
    family: "sales",
    title: "reports.report.cancelledInvoices",
    reason: "reports.reason.saleStatusHasNoCancelled",
  },
];

export const REPORT_COUNT = REPORT_CATALOG.length;