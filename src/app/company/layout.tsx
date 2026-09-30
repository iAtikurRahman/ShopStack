import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";

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

  const dictionary = getDictionary(await readLocaleCookie());

  return (
    <div className="min-h-screen bg-slate-100">
      <WorkspaceHeader
        role={role}
        title={translate(dictionary, "nav.company")}
        name={name}
        homeHref="/company"
      />
      <main>{children}</main>
    </div>
  );
}
