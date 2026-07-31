import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

// Read-only: store roles pick a supplier for purchases/supplier-returns,
// but supplier records themselves are managed at the company level
// (see /api/company/suppliers).
export const GET = withAuth(async (_request, { db }) => {
  const suppliers = await db.supplier.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ suppliers });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });
