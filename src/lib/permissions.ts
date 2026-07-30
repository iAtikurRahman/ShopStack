import type { PrismaClient, Role } from "@/generated/tenant";
import type { PermissionKey } from "@/lib/permission-catalog";
import type { TenantSession } from "@/lib/auth";

/**
 * Default capability set per role. Covers the common case with zero DB
 * reads; per-user exceptions are layered on top via UserPermissionOverride
 * (see hasPermission below).
 */
export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  company_admin: [
    "can_manage_users",
    "can_manage_inventory",
    "can_process_returns",
    "can_view_reports",
    "can_manage_products",
    "can_process_sales",
    "can_manage_customers",
    "product.view",
    "product.create",
    "product.update",
    "product.delete",
  ],
  store_manager: [
    "can_manage_inventory",
    "can_process_returns",
    "can_view_reports",
    "can_process_sales",
    "can_manage_customers",
    "product.view",
    "product.create",
    "product.update",
    "product.delete",
  ],
  // store_user gets none of the product.* permissions by default - a Store
  // Manager grants them individually as per-user overrides at creation
  // time (or later), so a store_user can hold e.g. view+create without
  // delete.
  store_user: ["can_process_sales", "can_manage_customers"],
};

/** override (if any) wins, otherwise falls back to the role default. */
export async function hasPermission(
  db: PrismaClient,
  session: TenantSession,
  key: PermissionKey
): Promise<boolean> {
  const override = await db.userPermissionOverride.findUnique({
    where: { userId_permissionKey: { userId: session.userId, permissionKey: key } },
  });
  if (override) return override.allow;
  return ROLE_PERMISSIONS[session.role].includes(key);
}
