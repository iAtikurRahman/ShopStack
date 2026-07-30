import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/validate-password";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth(async (_request, { db }) => {
  const stores = await db.store.findMany({
    include: { _count: { select: { warehouses: true, users: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ stores });
}, { scope: "tenant", roles: ["company_admin"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, address, phone, storeManager } = body ?? {};

  if (!name) {
    return NextResponse.json({ message: "name is required" }, { status: 400 });
  }

  if (storeManager) {
    const { name: mgrName, email: mgrEmail, password: mgrPassword } = storeManager;
    if (!mgrName || !mgrEmail || !mgrPassword) {
      return NextResponse.json(
        { message: "storeManager requires name, email, and password" },
        { status: 400 }
      );
    }
    const passwordError = validatePassword(mgrPassword);
    if (passwordError) {
      return NextResponse.json({ message: passwordError }, { status: 400 });
    }
    const existingUser = await db.user.findUnique({ where: { email: mgrEmail } });
    if (existingUser) {
      return NextResponse.json({ message: "A user with this email already exists" }, { status: 409 });
    }
  }

  const result = await db.$transaction(async (tx) => {
    const store = await tx.store.create({ data: { name, address, phone } });
    await writeAuditLog(tx, session, {
      action: "store.created",
      entityType: "Store",
      entityId: store.id,
      after: { name: store.name },
    });

    if (!storeManager) {
      return { store, manager: null };
    }

    const manager = await tx.user.create({
      data: {
        name: storeManager.name,
        email: storeManager.email,
        password: await hashPassword(storeManager.password),
        role: "store_manager",
        storeId: store.id,
      },
      select: { id: true, name: true, email: true, role: true, storeId: true },
    });
    await writeAuditLog(tx, session, {
      action: "user.created",
      entityType: "User",
      entityId: manager.id,
      after: { email: manager.email, role: manager.role, storeId: store.id },
    });

    return { store, manager };
  });

  return NextResponse.json(
    { store: result.store, storeManager: result.manager },
    { status: 201 }
  );
}, { scope: "tenant", roles: ["company_admin"] });
