import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { db }) => {
  const customers = await db.customer.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ customers });
}, { scope: "tenant", roles: ["company_admin"] });
