import type { PrismaClient } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { isGlobalStoreAccess, storeScopeWhere } from "@/lib/tenant-access";
import { getReport } from "./catalog";
import type { ReportContext } from "./definition";
import { resolvePeriod, type PeriodRequest } from "./period";
import type { ReportResult } from "./types";

/**
 * The one way to run a report.
 *
 * Both the JSON route and the PDF route call this, so the two can never compute
 * different numbers for the same request - a printable report that disagrees with
 * the screen is worse than no printable report at all.
 *
 * The context handed to a builder carries the caller's store scope already
 * applied, which is why every builder starts from `ctx.storeFilter` instead of
 * deciding for itself who may see what.
 */
export async function runReport(
  db: PrismaClient,
  session: TenantSession,
  key: string,
  request: PeriodRequest,
  now: Date = new Date()
): Promise<ReportResult> {
  const definition = getReport(key);
  const period = resolvePeriod(request, now);
  const context: ReportContext = {
    db,
    session,
    period,
    storeFilter: storeScopeWhere(session),
    scopedToStore: !isGlobalStoreAccess(session),
  };
  return definition.build(context);
}

/** The context a builder would be handed, for the rare caller that runs one
 *  outside a request (a test, or the dashboard comparing two windows). */
export function reportContext(db: PrismaClient, session: TenantSession, period: ReturnType<typeof resolvePeriod>): ReportContext {
  return {
    db,
    session,
    period,
    storeFilter: storeScopeWhere(session),
    scopedToStore: !isGlobalStoreAccess(session),
  };
}