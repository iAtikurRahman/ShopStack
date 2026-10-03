import { requireTenantSession } from "@/lib/session";
import StoresClient from "./StoresClient";

export default async function CompanyStoresPage() {
  const { session } = await requireTenantSession({ roles: ["company_admin", "store_manager"] });

  // Decided here rather than in the client: POST /api/company/stores is
  // company_admin-only, so the add form is not rendered for a store manager
  // instead of being shown and then refused.
  return <StoresClient canCreateStore={session.role === "company_admin"} />;
}