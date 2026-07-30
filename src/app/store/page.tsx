import { requireTenantSession } from "@/lib/session";

export default async function StoreDashboardPage() {
  const { session, db } = await requireTenantSession({ roles: ["store_manager", "store_user"] });
  const store = session.storeId
    ? await db.store.findUnique({ where: { id: session.storeId } })
    : null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Welcome, {session.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {store ? `You are working from ${store.name}.` : "No store assigned yet."}
        </p>
        <p className="mt-1 text-sm text-slate-600">POS checkout lands in a later phase.</p>
      </div>
    </main>
  );
}
