import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { PERMISSION_CATALOG, type PermissionKey } from "@/lib/permission-catalog";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";

export const GET = withAuth<{ id: string }>(async (_request, { db, params }) => {
  const userId = Number(params.id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ message: "Invalid user id" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  const overrides = await db.userPermissionOverride.findMany({ where: { userId } });
  const overrideMap = new Map(overrides.map((o) => [o.permissionKey, o.allow]));
  const roleDefaults = new Set(ROLE_PERMISSIONS[user.role]);

  return NextResponse.json({
    permissions: PERMISSION_CATALOG.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      roleDefault: roleDefaults.has(p.key as PermissionKey),
      override: overrideMap.has(p.key) ? overrideMap.get(p.key) : null,
    })),
  });
}, { scope: "tenant", roles: ["company_admin"] });

export const PUT = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const userId = Number(params.id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ message: "Invalid user id" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ message: "User not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const overrides: { permissionKey: string; allow: boolean | null }[] = body?.overrides ?? [];
  const validKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));

  for (const { permissionKey, allow } of overrides) {
    if (!validKeys.has(permissionKey as PermissionKey)) {
      return NextResponse.json({ message: `Unknown permission key: ${permissionKey}` }, { status: 400 });
    }
    if (allow === null) {
      await db.userPermissionOverride.deleteMany({ where: { userId, permissionKey } });
    } else {
      await db.userPermissionOverride.upsert({
        where: { userId_permissionKey: { userId, permissionKey } },
        update: { allow },
        create: { userId, permissionKey, allow },
      });
    }
  }

  await writeAuditLog(db, session, {
    action: "user.permissions_updated",
    entityType: "User",
    entityId: userId,
    after: { overrides },
  });

  return NextResponse.json({ ok: true });
}, { scope: "tenant", roles: ["company_admin"] });
