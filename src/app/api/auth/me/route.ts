import { NextResponse } from "next/server";
import { verifySession } from "@/lib/session";

export async function GET() {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ message: "No active session" }, { status: 401 });
  }

  if (session.kind === "project_admin") {
    return NextResponse.json({
      kind: "project_admin",
      name: session.name,
      email: session.email,
    });
  }

  return NextResponse.json({
    kind: "tenant",
    name: session.name,
    email: session.email,
    role: session.role,
    storeId: session.storeId,
    companyId: session.companyId,
  });
}
