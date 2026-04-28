"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { apiFetch } from "@/services/api";

type Product = {
  id: number;
  name: string;
  quantity: number;
  shop: { name: string };
};

type Sale = {
  id: number;
  totalAmount: string;
  createdAt: string;
};

type Expense = {
  id: number;
  amount: string;
  title: string;
};

export default function DashboardPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      setError(null);

      try {
        const [salesData, expenseData, productData] = await Promise.all([
          apiFetch<Sale[]>("/api/sales"),
          apiFetch<Expense[]>("/api/expenses"),
          apiFetch<Product[]>("/api/products"),
        ]);

        setSales(salesData);
        setExpenses(expenseData);
        setProducts(productData);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  const totalSales = sales.reduce((acc, sale) => acc + Number(sale.totalAmount), 0);
  const totalExpenses = expenses.reduce((acc, expense) => acc + Number(expense.amount), 0);
  const profitLoss = totalSales - totalExpenses;
  const lowStock = products.filter((product) => product.quantity <= 10);

  return (
    <AppShell title="Dashboard">
      <section className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Total Sales</p>
            <p className="mt-4 text-3xl font-semibold text-slate-950">${totalSales.toFixed(2)}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Total Expenses</p>
            <p className="mt-4 text-3xl font-semibold text-slate-950">${totalExpenses.toFixed(2)}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Profit / Loss</p>
            <p className="mt-4 text-3xl font-semibold text-slate-950">${profitLoss.toFixed(2)}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.95fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">Recent Sales</h2>
              <span className="text-sm text-slate-500">{sales.length} entries</span>
            </div>
            {sales.length === 0 ? (
              <p className="text-sm text-slate-600">No sales recorded yet.</p>
            ) : (
              <div className="space-y-4">
                {sales.slice(0, 5).map((sale) => (
                  <div key={sale.id} className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-sm text-slate-700">Sale #{sale.id}</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">${Number(sale.totalAmount).toFixed(2)}</p>
                    <p className="mt-1 text-sm text-slate-500">{new Date(sale.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">Low Stock Alerts</h2>
              <span className="text-sm text-slate-500">{lowStock.length} products</span>
            </div>
            {lowStock.length === 0 ? (
              <p className="text-sm text-slate-600">Stock levels look healthy.</p>
            ) : (
              <ul className="space-y-3">
                {lowStock.map((product) => (
                  <li key={product.id} className="rounded-3xl border border-rose-100 bg-rose-50 p-4">
                    <p className="font-semibold text-slate-950">{product.name}</p>
                    <p className="text-sm text-slate-600">{product.shop.name} — {product.quantity} left</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error ? <p className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
        {loading ? <p className="text-sm text-slate-600">Loading dashboard…</p> : null}
      </section>
    </AppShell>
  );
}
