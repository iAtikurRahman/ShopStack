import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { storeScopeWhere } from "@/lib/tenant-access";

export const GET = withAuth(async (_request, { session, db }) => {
  const sales = await db.sale.findMany({
    where: storeScopeWhere(session),
    include: { items: true, payments: true, customer: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ sales });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });
