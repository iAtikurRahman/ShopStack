import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import StoreUsersClient from "./StoreUsersClient";

export default async function StoreUsersPage() {
  try {
    await requireTenantSession({ roles: ["company_admin"] });
  } catch (err) {
    if (err instanceof ApiError) redirect(err.status === 401 ? "/login" : "/store");
    throw err;
  }
  return <StoreUsersClient />;
}