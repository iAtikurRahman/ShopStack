import { requireTenantSession } from "@/lib/session";

export default async function CompanyDashboardPage() {
  const { session, db } = await requireTenantSession({ roles: ["company_admin"] });
  const [storeCount, userCount] = await Promise.all([
    db.store.count(),
    db.user.count(),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Welcome, {session.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Store and warehouse management lands in the next phase.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Stores</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{storeCount}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Users</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{userCount}</p>
        </div>
      </div>
    </main>
  );
}
