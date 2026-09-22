import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { db }) => {
  const customers = await db.customer.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ customers });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

export const POST = withAuth(async (request, { db }) => {
  const body = await request.json().catch(() => null);
  const { name, phone, email } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  const customer = await db.customer.create({ data: { name, phone, email } });
  return NextResponse.json({ customer }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });
