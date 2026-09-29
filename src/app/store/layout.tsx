import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  let name: string;
  let role: "company_admin" | "store_manager" | "store_user";
  try {
    const { session } = await requireTenantSession({ roles: ["company_admin", "store_manager", "store_user"] });
    name = session.name;
    role = session.role;
  } catch (err) {
    if (err instanceof ApiError) redirect("/login");
    throw err;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <WorkspaceHeader
        role={role}
        title="Store"
        name={name}
        homeHref={role === "company_admin" ? "/company" : "/store"}
      />
      <main>{children}</main>
    </div>
  );
}
