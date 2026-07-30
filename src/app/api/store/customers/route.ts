import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

// Customers aren't store-scoped in the schema (a customer can shop at any
// store in the company), so this intentionally returns the full tenant
// customer list rather than filtering by session.storeId.
export const GET = withAuth(async (_request, { db }) => {
  const customers = await db.customer.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ customers });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });

export const POST = withAuth(async (request, { db }) => {
  const body = await request.json().catch(() => null);
  const { name, phone, email } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  const customer = await db.customer.create({ data: { name, phone, email } });
  return NextResponse.json({ customer }, { status: 201 });
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "can_manage_customers" });
