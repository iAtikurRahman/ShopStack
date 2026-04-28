"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch } from "@/services/api";

type Shop = {
  id: number;
  name: string;
  address: string;
};

export default function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchShops() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<Shop[]>("/api/shops");
        setShops(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchShops();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const created = await apiFetch<Shop>("/api/shops", "POST", { name, address });
      setShops((current) => [created, ...current]);
      setName("");
      setAddress("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AppShell title="Shop Management">
      <section className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Shops</h2>
            <p className="mt-2 text-sm text-slate-600">Manage active shop locations and addresses.</p>

            {loading ? (
              <p className="mt-6 text-sm text-slate-600">Loading shops…</p>
            ) : shops.length === 0 ? (
              <p className="mt-6 text-sm text-slate-600">No shops added yet.</p>
            ) : (
              <div className="mt-6 space-y-4">
                {shops.map((shop) => (
                  <div key={shop.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-lg font-semibold text-slate-950">{shop.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{shop.address}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Add a new shop</h2>
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Shop name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Address</span>
                <input
                  type="text"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Create Shop
              </button>
            </form>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
