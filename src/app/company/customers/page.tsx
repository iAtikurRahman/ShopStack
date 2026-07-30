"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Customer = { id: number; name: string; phone: string | null; email: string | null; loyaltyPoints: number };

export default function CompanyCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<{ customers: Customer[] }>("/api/company/customers");
        setCustomers(data.customers);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Customers</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : customers.length === 0 ? (
          <p className="text-sm text-slate-600">No customers yet.</p>
        ) : (
          <div className="space-y-3">
            {customers.map((customer) => (
              <div key={customer.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div>
                  <p className="font-semibold text-slate-950">{customer.name}</p>
                  <p className="text-sm text-slate-600">{customer.phone ?? customer.email ?? "—"}</p>
                </div>
                <span className="text-sm text-slate-500">{customer.loyaltyPoints} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
