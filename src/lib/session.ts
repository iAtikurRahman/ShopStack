import "server-only";
import { cache } from "react";
import type { Role, PrismaClient as TenantPrismaClient } from "@/generated/tenant";
import {
  readSessionCookie,
  verifySessionToken,
  type SessionPayload,
  type ProjectAdminSession,
  type TenantSession,
} from "@/lib/auth";
import { getTenantClient, TenantNotProvisionedError } from "@/lib/tenant-db";
import { hasPermission } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permission-catalog";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Verifies + decodes the session cookie once per request/render pass. */
export const verifySession = cache(async (): Promise<SessionPayload | null> => {
  const token = await readSessionCookie();
  if (!token) return null;
  return verifySessionToken(token);
});

export async function requireProjectAdmin(): Promise<ProjectAdminSession> {
  const session = await verifySession();
  if (!session || session.kind !== "project_admin") {
    throw new ApiError(401, "Project admin session required");
  }
  return session;
}

export interface RequireTenantSessionOptions {
  roles?: Role[];
  permission?: PermissionKey;
}

export interface TenantSessionContext {
  session: TenantSession;
  db: TenantPrismaClient;
}

export async function requireTenantSession(
  options: RequireTenantSessionOptions = {}
): Promise<TenantSessionContext> {
  const session = await verifySession();
  if (!session || session.kind !== "tenant") {
    throw new ApiError(401, "Session required");
  }

  let db: TenantPrismaClient;
  try {
    db = await getTenantClient(session.companyId);
  } catch (err) {
    if (err instanceof TenantNotProvisionedError) {
      throw new ApiError(401, "Tenant is not available");
    }
    throw err;
  }

  // Defense-in-depth: confirm the resolved tenant database actually
  // believes it belongs to this company, catching a misrouted mapping row.
  const config = await db.tenantConfig.findUnique({ where: { id: 1 } });
  if (!config || config.companyId !== session.companyId) {
    throw new ApiError(401, "Tenant database mismatch");
  }

  if (options.roles && !options.roles.includes(session.role)) {
    throw new ApiError(403, "Insufficient role");
  }

  if (options.permission && !(await hasPermission(db, session, options.permission))) {
    throw new ApiError(403, "Missing permission");
  }

  return { session, db };
}
