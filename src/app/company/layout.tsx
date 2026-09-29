import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  let name: string;
  let role: "company_admin" | "store_manager";
  try {
    const { session } = await requireTenantSession({ roles: ["company_admin", "store_manager"] });
    name = session.name;
    role = session.role === "store_manager" ? "store_manager" : "company_admin";
  } catch (err) {
    if (err instanceof ApiError) redirect("/login");
    throw err;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <WorkspaceHeader role={role} title="Company Admin" name={name} homeHref="/company" />
      <main>{children}</main>
    </div>
  );
}
