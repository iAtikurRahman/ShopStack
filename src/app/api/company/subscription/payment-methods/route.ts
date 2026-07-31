import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

export const GET = withAuth(async () => {
  const paymentMethods = await centralDb.paymentMethodConfig.findMany({
    where: { isEnabled: true },
    orderBy: { method: "asc" },
  });
  return NextResponse.json({ paymentMethods });
}, { scope: "tenant", roles: ["company_admin"] });
