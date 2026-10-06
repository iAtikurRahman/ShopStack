import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import UsersClient from "./UsersClient";

export default async function CompanyUsersPage() {
  try {
    await requireTenantSession({ roles: ["company_admin"] });
  } catch (err) {
    if (err instanceof ApiError) redirect(err.status === 401 ? "/login" : "/store");
    throw err;
  }
  return <UsersClient />;
}