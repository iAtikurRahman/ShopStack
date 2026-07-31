import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

export const GET = withAuth(async (_request, { session }) => {
  const notifications = await centralDb.notification.findMany({
    where: { companyId: session.companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ notifications });
}, { scope: "tenant", roles: ["company_admin"] });

export const PATCH = withAuth(async (request, { session }) => {
  const body = await request.json().catch(() => null);
  const { id } = body ?? {};
  if (!id) {
    return NextResponse.json({ message: "id is required" }, { status: 400 });
  }

  const notification = await centralDb.notification.findUnique({ where: { id: Number(id) } });
  if (!notification || notification.companyId !== session.companyId) {
    return NextResponse.json({ message: "Notification not found" }, { status: 404 });
  }

  const updated = await centralDb.notification.update({
    where: { id: Number(id) },
    data: { isRead: true },
  });
  return NextResponse.json({ notification: updated });
}, { scope: "tenant", roles: ["company_admin"] });
