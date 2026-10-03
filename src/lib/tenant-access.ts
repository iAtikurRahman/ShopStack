import type { TenantSession } from "@/lib/auth";

// company_admin has no store bound to their session (storeId is null),
// so every store-scoped endpoint must treat them as having access to all
// stores/warehouses in the tenant. Store staff are still scoped to their
// own store via the checks below.

export function isGlobalStoreAccess(session: TenantSession): boolean {
  return session.role === "company_admin" || session.storeId === null;
}

/** Prisma `where` fragment that scopes to the caller's store when they
 * have one, or matches every store when they don't. */
export function storeScopeWhere(session: TenantSession): { storeId?: number } {
  return session.storeId !== null ? { storeId: session.storeId } : {};
}

/** Same scoping, for queries on `Store` itself - where the store's primary key
 * is the scope, because the row *is* the store. Without this a store manager
 * is handed every store in the company on the list route while canAccessStore
 * still refuses all but their own, so clicking Edit on a neighbour answers
 * "Store not found" instead of an honest 403. */
export function storeListWhere(session: TenantSession): { id?: number } {
  return isGlobalStoreAccess(session) ? {} : { id: session.storeId as number };
}

/** Ownership guard: allowed to touch a warehouse/sale belonging to a store. */
export function canAccessStore(session: TenantSession, storeId: number | null): boolean {
  return isGlobalStoreAccess(session) || storeId === session.storeId;
}

/** Resolve which store an action should target. Company-wide roles may
 * supply their own storeId; store staff always use their own. */
export function resolveStoreId(session: TenantSession, supplied?: number | string | null): number | null {
  if (session.storeId !== null) return session.storeId;
  const id = Number(supplied);
  return Number.isInteger(id) && id > 0 ? id : null;
}