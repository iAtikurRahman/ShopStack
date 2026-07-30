import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth(async (_request, { db }) => {
  const categories = await db.category.findMany({
    include: { parent: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ categories });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, parentId } = body ?? {};
  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  const category = await db.category.create({
    data: { name, parentId: parentId ? Number(parentId) : null },
  });
  await writeAuditLog(db, session, {
    action: "category.created",
    entityType: "Category",
    entityId: category.id,
    after: { name: category.name },
  });
  return NextResponse.json({ category }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin"] });
