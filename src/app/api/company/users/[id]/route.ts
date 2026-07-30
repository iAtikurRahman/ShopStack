import { NextResponse } from "next/server";
import type { Role } from "@/generated/tenant";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

const VALID_ROLES: Role[] = ["company_admin", "store_manager", "store_user"];

export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const userId = Number(params.id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ message: "Invalid user id" }, { status: 400 });
  }

  const before = await db.user.findUnique({ where: { id: userId } });
  if (!before) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const { name, email, role, storeId, isActive } = body ?? {};

  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return NextResponse.json({ message: "Invalid role" }, { status: 400 });
  }
  // A company_admin must not be able to strip their own admin role/deactivate
  // themselves and get locked out with no company_admin left.
  if (userId === session.userId && (role !== undefined && role !== "company_admin")) {
    return NextResponse.json({ message: "You cannot change your own role" }, { status: 400 });
  }
  if (userId === session.userId && isActive === false) {
    return NextResponse.json({ message: "You cannot deactivate your own account" }, { status: 400 });
  }

  const user = await db.user.update({
    where: { id: userId },
    data: {
      name,
      email,
      role,
      storeId: role === "company_admin" ? null : storeId !== undefined ? Number(storeId) : undefined,
      isActive,
    },
    select: { id: true, name: true, email: true, role: true, storeId: true, isActive: true },
  });

  await writeAuditLog(db, session, {
    action: "user.updated",
    entityType: "User",
    entityId: user.id,
    before: { email: before.email, role: before.role, isActive: before.isActive },
    after: { email: user.email, role: user.role, isActive: user.isActive },
  });

  return NextResponse.json({ user });
}, { scope: "tenant", roles: ["company_admin"] });

export const DELETE = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const userId = Number(params.id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ message: "Invalid user id" }, { status: 400 });
  }
  if (userId === session.userId) {
    return NextResponse.json({ message: "You cannot deactivate your own account" }, { status: 400 });
  }

  // Deactivate rather than hard-delete: sales/returns/audit rows still
  // reference this user's id, and a soft delete keeps that history intact.
  const user = await db.user.update({
    where: { id: userId },
    data: { isActive: false },
    select: { id: true, email: true },
  });

  await writeAuditLog(db, session, {
    action: "user.deactivated",
    entityType: "User",
    entityId: user.id,
    after: { email: user.email },
  });

  return NextResponse.json({ ok: true });
}, { scope: "tenant", roles: ["company_admin"] });
