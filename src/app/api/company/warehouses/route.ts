import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

// Tenant-wide, read-only warehouse list for company_admin (e.g. picking
// where to stock a newly created product) - mirrors /api/store/warehouses'
// GET, which is scoped to store roles instead.
export const GET = withAuth(async (_request, { db }) => {
  const warehouses = await db.warehouse.findMany({
    where: { isActive: true },
    include: { store: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ warehouses });
}, { scope: "tenant", roles: ["company_admin"] });
