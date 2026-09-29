"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/services/api";

type Supplier = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
};
type Place = { id: number; name: string; store: { id: number; name: string } };
type PurchaseItem = {
  id: number;
  productId: number;
  quantity: number;
  unitCost: string;
  product: { id: number; sku: string; name: string };
  warehouse: Place;
};
type Purchase = {
  id: number;
  reference: string | null;
  totalCost: string;
  purchasedAt: string;
  warehouse: Place | null;
  items: PurchaseItem[];
};
type SupplierReturnRow = {
  id: number;
  quantity: number;
  amount: string;
  reason: string | null;
  createdAt: string;
  product: { id: number; sku: string; name: string };
  warehouse: Place;
};

type Detail = { supplier: Supplier; purchases: Purchase[]; supplierReturns: SupplierReturnRow[] };

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<Detail>(`/api/company/suppliers/${id}`);
        setData(res);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const stats = useMemo(() => {
    const purchases = data?.purchases ?? [];
    const totalCost = purchases.reduce((sum, p) => sum + Number(p.totalCost), 0);
    const units = purchases.reduce((sum, p) => sum + p.items.reduce((s, i) => s + i.quantity, 0), 0);
    const returned = data?.supplierReturns ?? [];
    return {
      purchaseCount: purchases.length,
      totalCost,
      units,
      averageCost: purchases.length > 0 ? totalCost / purchases.length : 0,
      lastPurchaseAt: purchases.length > 0 ? purchases[0].purchasedAt : null,
      returnedUnits: returned.reduce((sum, r) => sum + r.quantity, 0),
      returnedAmount: returned.reduce((sum, r) => sum + Number(r.amount), 0),
    };
  }, [data]);

  const filteredPurchases = useMemo(() => {
    const purchases = data?.purchases ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    const digits = q.replace(/\D/g, "");
    return purchases.filter((purchase) => {
      const products = purchase.items.map((i) => i.product.name.toLowerCase());
      const places = purchase.items.map((i) => `${i.warehouse.name} ${i.warehouse.store.name}`.toLowerCase());
      return (
        String(purchase.id).includes(q) ||
        (purchase.reference ?? "").toLowerCase().includes(q) ||
        purchase.totalCost.includes(q) ||
        purchase.purchasedAt.slice(0, 10).includes(q) ||
        products.some((name) => name.includes(q)) ||
        places.some((name) => name.includes(q)) ||
        (digits.length > 0 && purchase.totalCost.replace(/\D/g, "").includes(digits))
      );
    });
  }, [data, search]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <Link href="/company/suppliers" className="text-sm text-slate-600 hover:underline">
        ← Back to suppliers
      </Link>

      {loading ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : error || !data ? (
        <p className="text-sm text-red-600">{error ?? "Supplier not found"}</p>
      ) : (
        <>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-950">{data.supplier.name}</h1>
                <p className="mt-1 text-sm text-slate-600">
                  {[data.supplier.phone, data.supplier.email].filter(Boolean).join(" · ") || "No contact info"}
                </p>
                {data.supplier.address ? (
                  <p className="mt-0.5 text-xs text-slate-500">{data.supplier.address}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-slate-400">
                  Supplier since {new Date(data.supplier.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  data.supplier.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                }`}
              >
                {data.supplier.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">Purchases</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{stats.purchaseCount}</p>
              <p className="mt-1 text-xs text-slate-500">
                {stats.lastPurchaseAt
                  ? `Last on ${new Date(stats.lastPurchaseAt).toLocaleDateString()}`
                  : "No purchases yet"}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">Total purchased</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">৳{stats.totalCost.toFixed(2)}</p>
              <p className="mt-1 text-xs text-slate-500">
                Avg ৳{stats.averageCost.toFixed(2)} · {stats.units} unit{stats.units === 1 ? "" : "s"}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">Returned to supplier</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">৳{stats.returnedAmount.toFixed(2)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {stats.returnedUnits} unit{stats.returnedUnits === 1 ? "" : "s"} sent back
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">Purchase history</h2>
              <p className="text-sm text-slate-500">
                {filteredPurchases.length} purchase{filteredPurchases.length === 1 ? "" : "s"}
              </p>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by purchase #, reference, product, warehouse, amount or date…"
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
            />

            {filteredPurchases.length === 0 ? (
              <p className="mt-6 text-sm text-slate-600">
                {search.trim() ? `No purchases match "${search.trim()}".` : "This supplier has no purchases yet."}
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {filteredPurchases.map((purchase) => {
                  const units = purchase.items.reduce((sum, item) => sum + item.quantity, 0);
                  return (
                    <div key={purchase.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-950">
                            Purchase #{purchase.id}
                            {purchase.reference ? ` · ${purchase.reference}` : ""}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(purchase.purchasedAt).toLocaleString()} · {units} unit{units === 1 ? "" : "s"}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {purchase.warehouse
                              ? `${purchase.warehouse.name} (${purchase.warehouse.store.name})`
                              : [...new Set(purchase.items.map((i) => `${i.warehouse.name} (${i.warehouse.store.name})`))].join(
                                  ", "
                                )}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-medium text-slate-950">৳{purchase.totalCost}</p>
                          <p className="text-xs text-slate-500">cost</p>
                        </div>
                      </div>

                      <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                        {purchase.items.map((item) => (
                          <div key={item.id} className="flex justify-between gap-4 text-sm">
                            <span className="text-slate-950">
                              {item.product.name}
                              <span className="text-slate-500"> ({item.warehouse.name})</span>
                            </span>
                            <span className="shrink-0 text-slate-600">
                              {item.quantity} × ৳{item.unitCost} = ৳
                              {(item.quantity * Number(item.unitCost)).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {data.supplierReturns.length > 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Sent back to supplier</h2>
              <div className="mt-4 space-y-3">
                {data.supplierReturns.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-950">{row.product.name}</p>
                        <p className="text-xs text-slate-500">
                          {row.quantity} unit{row.quantity === 1 ? "" : "s"} · {row.warehouse.name} (
                          {row.warehouse.store.name})
                        </p>
                        {row.reason ? <p className="mt-1 text-xs text-slate-600">{row.reason}</p> : null}
                        <p className="mt-0.5 text-xs text-slate-400">{new Date(row.createdAt).toLocaleString()}</p>
                      </div>
                      <p className="shrink-0 text-right font-medium text-red-600">-৳{row.amount}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
