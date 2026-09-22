import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/validate-password";
import { writeAuditLog } from "@/lib/audit";
import { PERMISSION_CATALOG, type PermissionKey } from "@/lib/permission-catalog";
import { storeScopeWhere } from "@/lib/tenant-access";

// Store-scoped user list: only users belonging to THIS Store Manager's own
// store, or all store users for company-wide roles.
export const GET = withAuth(async (_request, { session, db }) => {
  const users = await db.user.findMany({
    where: storeScopeWhere(session),
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });

// Store Managers create store_user accounts (never store_manager or
// company_admin - "a role can only create roles strictly below it").
// Company-wide roles may pass a storeId from the body; role is
// intentionally not read from the request body at all.
export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { name, email, password, permissions, storeId } = body ?? {};

  if (!name || !email || !password) {
    return NextResponse.json({ message: "name, email, and password are required" }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ message: passwordError }, { status: 400 });
  }
  const targetStoreId = session.storeId ?? (storeId ? Number(storeId) : null);
  if (!targetStoreId) {
    return NextResponse.json({ message: "storeId is required for company-wide roles" }, { status: 400 });
  }
  const store = await db.store.findUnique({ where: { id: targetStoreId } });
  if (!store) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const validKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));
  const grantedPermissions: PermissionKey[] = Array.isArray(permissions)
    ? permissions.filter((p: string) => validKeys.has(p as PermissionKey))
    : [];

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ message: "A user with this email already exists" }, { status: 409 });
  }

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        role: "store_user",
        storeId: targetStoreId,
      },
      select: { id: true, name: true, email: true, role: true, storeId: true, isActive: true },
    });

    if (grantedPermissions.length > 0) {
      await tx.userPermissionOverride.createMany({
        data: grantedPermissions.map((permissionKey) => ({
          userId: created.id,
          permissionKey,
          allow: true,
        })),
      });
    }

    await writeAuditLog(tx, session, {
      action: "user.created",
      entityType: "User",
      entityId: created.id,
      after: { email: created.email, role: created.role, storeId: created.storeId, permissions: grantedPermissions },
    });

    return created;
  });

  return NextResponse.json({ user, permissions: grantedPermissions }, { status: 201 });
}, { scope: "tenant", roles: ["company_admin", "store_manager"] });
