import { NextResponse } from "next/server";
import type { Role } from "@/generated/tenant";
import { withAuth } from "@/lib/api-guard";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/validate-password";
import { writeAuditLog } from "@/lib/audit";

const VALID_ROLES: Role[] = ["company_admin", "store_manager", "store_user"];

export const GET = withAuth(async (_request, { db }) => {
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, storeId: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, email, password, role, storeId } = body ?? {};

  if (!name || !email || !password || !role) {
    return NextResponse.json({ message: "name, email, password, and role are required" }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ message: "Invalid role" }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ message: passwordError }, { status: 400 });
  }
  if ((role === "store_manager" || role === "store_user") && !storeId) {
    return NextResponse.json({ message: "storeId is required for store roles" }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ message: "A user with this email already exists" }, { status: 409 });
  }

  if (storeId) {
    const store = await db.store.findUnique({ where: { id: Number(storeId) } });
    if (!store) {
      return NextResponse.json({ message: "Store not found" }, { status: 404 });
    }
  }

  const user = await db.user.create({
    data: {
      name,
      email,
      password: await hashPassword(password),
      role,
      storeId: role === "company_admin" ? null : Number(storeId),
    },
    select: { id: true, name: true, email: true, role: true, storeId: true, isActive: true },
  });

  await writeAuditLog(db, session, {
    action: "user.created",
    entityType: "User",
    entityId: user.id,
    after: { email: user.email, role: user.role },
  });

  return NextResponse.json({ user }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin"] });
