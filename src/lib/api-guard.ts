import { NextRequest, NextResponse } from "next/server";
import type { Role, PrismaClient as TenantPrismaClient } from "@/generated/tenant";
import { ApiError, requireProjectAdmin, requireTenantSession } from "@/lib/session";
import type { ProjectAdminSession, TenantSession } from "@/lib/auth";
import type { PermissionKey } from "@/lib/permission-catalog";

type ProjectAdminGuardOptions = { scope: "project_admin" };
type TenantGuardOptions = { scope: "tenant"; roles?: Role[]; permission?: PermissionKey };
export type GuardOptions = ProjectAdminGuardOptions | TenantGuardOptions;

type ProjectAdminHandlerContext<P> = { scope: "project_admin"; session: ProjectAdminSession; params: P };
type TenantHandlerContext<P> = { scope: "tenant"; session: TenantSession; db: TenantPrismaClient; params: P };
export type GuardedContext<P> = ProjectAdminHandlerContext<P> | TenantHandlerContext<P>;

type RouteContext<P> = { params: Promise<P> };

type GuardedHandler<P> = (request: NextRequest, ctx: GuardedContext<P>) => Promise<Response>;
type WrappedHandler<P> = (request: NextRequest, routeContext: RouteContext<P>) => Promise<Response>;

/**
 * Wraps a route handler so it can ONLY ever run with an already-verified,
 * already tenant-scoped `db` (for tenant scope) or verified ProjectAdmin
 * session (for project_admin scope). This replaces the old pattern of
 * manually calling requireAuth(...) at the top of every handler body -
 * every route under src/app/api/{admin,company,store}/** should be built
 * via this wrapper so there is no opt-in gap to forget.
 *
 * Overloaded so the handler's `ctx` parameter is narrowed to the right
 * variant (tenant `ctx.db` vs project_admin `ctx.session`) based on the
 * `options.scope` passed at the call site, instead of forcing every
 * handler to deal with the full union.
 */
export function withAuth<P = Record<string, never>>(
  handler: (request: NextRequest, ctx: TenantHandlerContext<P>) => Promise<Response>,
  options: TenantGuardOptions
): WrappedHandler<P>;
export function withAuth<P = Record<string, never>>(
  handler: (request: NextRequest, ctx: ProjectAdminHandlerContext<P>) => Promise<Response>,
  options: ProjectAdminGuardOptions
): WrappedHandler<P>;
export function withAuth<P = Record<string, never>>(
  handler: (request: NextRequest, ctx: never) => Promise<Response>,
  options: GuardOptions
): WrappedHandler<P> {
  const guardedHandler = handler as unknown as GuardedHandler<P>;
  return async (request: NextRequest, routeContext: RouteContext<P>): Promise<Response> => {
    try {
      const params = await routeContext.params;

      if (options.scope === "project_admin") {
        const session = await requireProjectAdmin();
        return await guardedHandler(request, { scope: "project_admin", session, params });
      }

      const { session, db } = await requireTenantSession(options);
      return await guardedHandler(request, { scope: "tenant", session, db, params });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ message: err.message }, { status: err.status });
      }
      console.error(err);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  };
}
