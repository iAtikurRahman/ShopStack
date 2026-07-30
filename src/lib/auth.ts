import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/generated/tenant";

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in environment variables");
}
const encodedSecret = new TextEncoder().encode(SESSION_SECRET);

export const SESSION_COOKIE = "shopstack_session";
const SESSION_TTL = "7d";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ProjectAdminSession = {
  kind: "project_admin";
  projectAdminId: number;
  email: string;
  name: string;
};

export type TenantSession = {
  kind: "tenant";
  userId: number;
  companyId: number;
  storeId: number | null;
  role: Role;
  email: string;
  name: string;
};

export type SessionPayload = ProjectAdminSession | TenantSession;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(encodedSecret);
}

/** Verifies signature + expiry only. Safe to call on the Edge runtime (proxy.ts). */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encodedSecret, { algorithms: ["HS256"] });
    if (payload.kind === "project_admin" || payload.kind === "tenant") {
      return payload as unknown as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}
