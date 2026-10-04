import type { PrismaClient } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { REPORT_FAMILIES, type ReportFamily, type ReportDraft, type ReportPeriod } from "./types";

/**
 * What a report builder is handed, and what it has to answer with.
 *
 * Every report in the catalog is one async function of this shape. That is what
 * lets ~80 reports share a single route, a single renderer and a single PDF
 * builder instead of each one growing its own page, its own API file and its own
 * table markup - three places per report that would all have to be kept in step
 * with each other.
 */

// Re-exported so the family list can be imported from either module; the list
// itself is declared in types.ts with the rest of the wire contract.
export { REPORT_FAMILIES, type ReportFamily };

export type ReportContext = {
  db: PrismaClient;
  session: TenantSession;
  period: ReportPeriod;
  /** Prisma `where` fragment scoping to the caller's store, or {} for a
   *  company_admin who has no store bound and therefore sees every store. */
  storeFilter: { storeId?: number };
  /** True when the caller is bound to one store. Reports that only make sense
   *  per store (cash drawer, hourly) use it to say so rather than pretending a
   *  company-wide figure is a shop's figure. */
  scopedToStore: boolean;
};

export type ReportBuilder = (ctx: ReportContext) => Promise<ReportDraft>;

export type ReportDefinition = {
  key: string;
  family: ReportFamily;
  /** Dictionary key for the report's own name, resolved on the client. */
  title: string;
  /** One line under the title in the catalog, so the list explains itself
   *  instead of being ~80 bare nouns. */
  description: string;
  /** Shortest window this report cannot answer, in days. Reports that bucket
   *  sales in memory set it to the trend cap; the screen then offers only the
   *  periods that fit, instead of letting the user pick a range that is refused.
   *  The builder still refuses it too - this is about not offering the mistake. */
  maxRangeDays?: number;
  build: ReportBuilder;
};