import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { session, db }) => {
  const sales = await db.sale.findMany({
    where: { storeId: session.storeId ?? -1 },
    include: { items: true, payments: true, customer: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ sales });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });
