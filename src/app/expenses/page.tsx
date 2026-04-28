"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch } from "@/services/api";

type Shop = { id: number; name: string };

type Expense = {
  id: number;
  title: string;
  amount: string;
  shop: Shop;
  createdAt: string;
};

export default function ExpensesPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState(0);
  const [shopId, setShopId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [shopData, expenseData] = await Promise.all([
          apiFetch<Shop[]>("/api/shops"),
          apiFetch<Expense[]>("/api/expenses"),
        ]);
        setShops(shopData);
        setExpenses(expenseData);
        if (shopData.length > 0) {
          setShopId(shopData[0].id);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!shopId) {
      setError("Please choose a shop.");
      return;
    }

    try {
      const newExpense = await apiFetch<Expense>("/api/expenses", "POST", {
        shopId,
        title,
        amount,
      });
      setExpenses((current) => [newExpense, ...current]);
      setTitle("");
      setAmount(0);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AppShell title="Expenses">
      <section className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Expense tracking</h2>
            <p className="mt-2 text-sm text-slate-600">Track costs for each shop with category details.</p>

            {loading ? (
              <p className="mt-6 text-sm text-slate-600">Loading expenses…</p>
            ) : expenses.length === 0 ? (
              <p className="mt-6 text-sm text-slate-600">No expenses recorded yet.</p>
            ) : (
              <div className="mt-6 space-y-4">
                {expenses.map((expense) => (
                  <div key={expense.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-slate-950">{expense.title}</p>
                        <p className="text-sm text-slate-600">{expense.shop.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-slate-950">${Number(expense.amount).toFixed(2)}</p>
                        <p className="text-sm text-slate-500">{new Date(expense.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-950">Add expense</h2>
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Shop</span>
                <select
                  value={shopId}
                  onChange={(event) => setShopId(Number(event.target.value))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                >
                  <option value="">Choose a shop</option>
                  {shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value))}
                  required
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
                />
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Record expense
              </button>
            </form>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
