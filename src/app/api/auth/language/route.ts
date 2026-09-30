import { NextRequest, NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import {
  signSessionToken,
  setSessionCookie,
  type ProjectAdminSession,
  type TenantSession,
} from "@/lib/auth";
import { requireTenantSession, verifySession } from "@/lib/session";
import { setLocaleCookie } from "@/lib/i18n/server-locale";
import { toLocale } from "@/lib/i18n/locale";

/**
 * Persists the language the reader picked: the account row keeps it for the
 * next sign-in, and the session + locale cookie keep the current render in
 * sync. Anonymous visitors (sign-in page) only get the cookie.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const language = toLocale(body?.language);
  const session = await verifySession();

  if (session?.kind === "tenant") {
    const { db } = await requireTenantSession();
    await db.user.update({ where: { id: session.userId }, data: { language } });
    const next: TenantSession = { ...session, language };
    await setSessionCookie(await signSessionToken(next));
  } else if (session?.kind === "project_admin") {
    await centralDb.projectAdmin.update({
      where: { id: session.projectAdminId },
      data: { language },
    });
    const next: ProjectAdminSession = { ...session, language };
    await setSessionCookie(await signSessionToken(next));
  }

  await setLocaleCookie(language);

  return NextResponse.json({ language });
}
