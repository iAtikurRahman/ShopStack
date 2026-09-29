"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/services/api";

type Customer = { id: number; name: string; phone: string | null; email: string | null; loyaltyPoints: number };

export default function StoreCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");

  async function loadCustomers() {
    try {
      const data = await apiFetch<{ customers: Customer[] }>("/api/store/customers");
      setCustomers(data.customers);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadCustomers();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/store/customers", "POST", { name, phone: phone || null, email: email || null });
      setName("");
      setPhone("");
      setEmail("");
      await loadCustomers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const digits = q.replace(/\D/g, "");
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && (c.phone ?? "").replace(/\D/g, "").includes(digits))
      );
    });
  }, [customers, search]);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Customers</h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">All customers</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone or email…"
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : filteredCustomers.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim() ? `No customers match "${search.trim()}".` : "No customers yet."}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredCustomers.map((customer) => (
                <Link
                  key={customer.id}
                  href={`/store/customers/${customer.id}`}
                  className="block rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-950">{customer.name}</p>
                    <span className="text-xs text-slate-500">{customer.loyaltyPoints} pts</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {customer.phone ? `Phone: ${customer.phone}` : null}
                  </p>
                  <p className="text-sm text-slate-600">{customer.email ? `Email: ${customer.email}` : null}</p>
                  {!customer.phone && !customer.email ? <p className="mt-1 text-sm text-slate-600">—</p> : null}
                  <p className="mt-2 text-xs font-semibold text-slate-600">View purchases →</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Add a customer</h2>
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
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Phone</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Add customer
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
