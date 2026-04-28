import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET as string | undefined;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required in environment variables");
}

const JWT_SECRET_VALUE = JWT_SECRET;

export interface AuthPayload {
  userId: number;
  email: string;
  name: string;
  role: string;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signToken(payload: AuthPayload) {
  return jwt.sign(payload, JWT_SECRET_VALUE, {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET_VALUE) as AuthPayload;
  } catch {
    return null;
  }
}

export function getAuthToken(request: Request | NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

export function requireAuth(request: Request | NextRequest, allowedRoles: string[] = []) {
  const token = getAuthToken(request);
  if (!token) {
    const error = new Error("Unauthorized");
    (error as any).status = 401;
    throw error;
  }

  const payload = verifyToken(token);
  if (!payload) {
    const error = new Error("Unauthorized");
    (error as any).status = 401;
    throw error;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(payload.role)) {
    const error = new Error("Forbidden");
    (error as any).status = 403;
    throw error;
  }

  return payload;
}
