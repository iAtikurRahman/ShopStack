"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/services/api";

type Plan = {
  id: number;
  name: string;
  duration: string;
  durationDays: number;
  price: string;
  isActive: boolean;
};

const DEFAULT_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, yearly: 365, custom: 30 };

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [duration, setDuration] = useState("monthly");
  const [durationDays, setDurationDays] = useState(String(DEFAULT_DAYS.monthly));
  const [price, setPrice] = useState("");

  async function loadPlans() {
    try {
      const data = await apiFetch<{ plans: Plan[] }>("/api/admin/subscriptions/plans");
      setPlans(data.plans);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadPlans();
    }
    load();
  }, []);

  function handleDurationChange(value: string) {
    setDuration(value);
    if (value !== "custom") setDurationDays(String(DEFAULT_DAYS[value]));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/admin/subscriptions/plans", "POST", {
        name,
        duration,
        durationDays: Number(durationDays),
        price: Number(price),
      });
      setName("");
      setPrice("");
      await loadPlans();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleActive(plan: Plan) {
    try {
      await apiFetch(`/api/admin/subscriptions/plans/${plan.id}`, "PATCH", { isActive: !plan.isActive });
      await loadPlans();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-950">Subscription plans</h1>
        <Link href="/admin/subscriptions" className="text-sm text-slate-600 hover:underline">
          ← Back to subscriptions
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">All plans</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : plans.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No plans yet.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {plans.map((plan) => (
                <div key={plan.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-950">{plan.name}</p>
                    <button
                      type="button"
                      onClick={() => toggleActive(plan)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        plan.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {plan.isActive ? "active" : "inactive"}
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    ৳{plan.price} · {plan.duration} · {plan.durationDays} days
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Add a plan</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monthly"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Duration</span>
              <select
                value={duration}
                onChange={(e) => handleDurationChange(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Duration (days)</span>
              <input
                required
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Price (৳)</span>
              <input
                required
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Add plan
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
