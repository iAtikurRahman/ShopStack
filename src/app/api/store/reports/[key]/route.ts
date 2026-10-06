import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { runReport } from "@/lib/reports/run";
import { ReportError } from "@/lib/reports/types";

/**
 * One report, as JSON.
 *
 * Every report in the catalog answers through this single route. The key is the
 * report's identity and the period is the only input; the store scope comes from
 * the session, never from the query, so there is no request that can widen it.
 */
export const GET = withAuth<{ key: string }>(async (request: NextRequest, { db, session, params }) => {
  const { key } = params;
  const search = request.nextUrl.searchParams;
  try {
    const result = await runReport(db, session, key, {
      preset: search.get("preset"),
      from: search.get("from"),
      to: search.get("to"),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReportError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}, { scope: "tenant", roles: ["company_admin"], permission: "can_view_reports" });