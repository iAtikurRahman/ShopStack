import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { getDayReport, resolveDayBounds } from "@/lib/reports";

// One day in detail, for the dashboard chart's click-through. The same
// can_view_reports gate as the rest of the report surface, and the same store
// scoping inside getDayReport, so this cannot be used to read another store.
export const GET = withAuth(async (request: NextRequest, { session, db }) => {
  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!resolveDayBounds(date)) {
    return NextResponse.json({ message: "Invalid date" }, { status: 400 });
  }
  const report = await getDayReport(db, session, date);
  if (!report) {
    return NextResponse.json({ message: "Invalid date" }, { status: 400 });
  }
  return NextResponse.json(report);
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_view_reports" });