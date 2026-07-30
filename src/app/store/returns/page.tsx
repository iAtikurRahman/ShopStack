"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/services/api";

type SaleItem = { id: number; productId: number; quantity: number; unitPrice: string };
type ReturnItem = { saleItemId: number; quantity: number };
type Sale = {
  id: number;
  status: string;
  items: SaleItem[];
  returns: { items: ReturnItem[] }[];
};

function ReturnsForm() {
  const searchParams = useSearchParams();
  const [saleIdInput, setSaleIdInput] = useState(searchParams.get("saleId") ?? "");
  const [sale, setSale] = useState<Sale | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadSale(id: string) {
    if (!id) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiFetch<{ sale: Sale }>(`/api/store/sales/${id}`);
      setSale(data.sale);
      setQuantities({});
    } catch (err) {
      setError((err as Error).message);
      setSale(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      if (saleIdInput) await loadSale(saleIdInput);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function remainingFor(item: SaleItem) {
    const returned = (sale?.returns ?? [])
      .flatMap((r) => r.items)
      .filter((ri) => ri.saleItemId === item.id)
      .reduce((sum, ri) => sum + ri.quantity, 0);
    return item.quantity - returned;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sale) return;
    setError(null);
    setSuccess(null);

    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId: Number(saleItemId), quantity }));

    if (items.length === 0) {
      setError("Enter a quantity to return for at least one item");
      return;
    }

    try {
      await apiFetch("/api/store/returns", "POST", { saleId: sale.id, items, reason });
      setSuccess("Return processed and stock restocked.");
      await loadSale(String(sale.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Process a return</h1>

      <div className="flex gap-3">
        <input
          value={saleIdInput}
          onChange={(e) => setSaleIdInput(e.target.value)}
          placeholder="Sale ID"
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
        />
        <button
          type="button"
          onClick={() => loadSale(saleIdInput)}
          className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
        >
          Load sale
        </button>
      </div>

      {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

      {sale ? (
        <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Sale #{sale.id}</h2>
          <div className="mt-4 space-y-3">
            {sale.items.map((item) => {
              const remaining = remainingFor(item);
              return (
                <div key={item.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-950">Product {item.productId}</p>
                    <p className="text-xs text-slate-500">
                      {item.quantity} sold · {remaining} returnable
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={remaining}
                    disabled={remaining <= 0}
                    value={quantities[item.id] ?? 0}
                    onChange={(e) =>
                      setQuantities((current) => ({ ...current, [item.id]: Number(e.target.value) }))
                    }
                    className="w-20 rounded-xl border border-slate-200 px-3 py-1.5 text-center outline-none focus:border-slate-900 disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">Reason (optional)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
            />
          </label>

          <button
            type="submit"
            className="mt-6 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Process return
          </button>
        </form>
      ) : null}
    </main>
  );
}

export default function StoreReturnsPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl p-8 text-sm text-slate-600">Loading…</main>}>
      <ReturnsForm />
    </Suspense>
  );
}
