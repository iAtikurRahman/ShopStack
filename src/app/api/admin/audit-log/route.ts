import { NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async () => {
  const entries = await centralDb.centralAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ entries });
}, { scope: "project_admin" });
