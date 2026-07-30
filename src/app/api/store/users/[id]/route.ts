import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

export const DELETE = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const userId = Number(params.id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ message: "Invalid user id" }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  // 404 (not 403) for both "doesn't exist" and "not in my store / not a
  // store_user" - a Store Manager should not be able to distinguish
  // "no such user" from "that user exists but isn't mine to manage".
  if (!target || target.storeId !== session.storeId || target.role !== "store_user") {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  await db.user.update({ where: { id: userId }, data: { isActive: false } });
  await writeAuditLog(db, session, {
    action: "user.deactivated",
    entityType: "User",
    entityId: userId,
    after: { email: target.email },
  });

  return NextResponse.json({ ok: true });
}, { scope: "tenant", roles: ["store_manager"] });
