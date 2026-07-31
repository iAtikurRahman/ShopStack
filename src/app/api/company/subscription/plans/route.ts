import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

export const GET = withAuth(async () => {
  const plans = await centralDb.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { price: "asc" },
  });
  return NextResponse.json({ plans });
}, { scope: "tenant", roles: ["company_admin"] });
