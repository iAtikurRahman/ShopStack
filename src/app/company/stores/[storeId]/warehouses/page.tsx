"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Warehouse = {
  id: number;
  name: string;
  isActive: boolean;
};

export default function StoreWarehousesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function loadWarehouses() {
    try {
      const data = await apiFetch<{ warehouses: Warehouse[] }>(`/api/company/stores/${storeId}/warehouses`);
      setWarehouses(data.warehouses);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadWarehouses();
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/company/stores/${storeId}/warehouses`, "POST", { name });
      setName("");
      await loadWarehouses();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <Link href="/company/stores" className="text-sm text-slate-600 hover:underline">
          ← Back to stores
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Warehouses</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Warehouses for this store</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : warehouses.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No warehouses yet.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {warehouses.map((warehouse) => (
                <div key={warehouse.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="font-semibold text-slate-950">{warehouse.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Add a warehouse</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Create warehouse
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
