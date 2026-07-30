import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * Optimistic route guard only - cookie presence + jose signature/expiry
 * check, no database access (can't reach Prisma from the Edge runtime
 * anyway). The authoritative check happens in the DAL (src/lib/session.ts)
 * via requireProjectAdmin()/requireTenantSession(), used by every page and
 * by withAuth() for API routes. This proxy exists purely to redirect
 * obviously-unauthenticated page visits before they render.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname.startsWith("/admin")) {
    if (!session || session.kind !== "project_admin") {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/company") || pathname.startsWith("/store")) {
    if (!session || session.kind !== "tenant") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (pathname.startsWith("/company") && session.role !== "company_admin") {
      return NextResponse.redirect(new URL("/store", request.url));
    }
    if (pathname.startsWith("/store") && session.role === "company_admin") {
      return NextResponse.redirect(new URL("/company", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/company/:path*", "/store/:path*"],
};
