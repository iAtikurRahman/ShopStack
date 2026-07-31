"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/services/api";

type PaymentMethodConfig = {
  method: string;
  displayName: string;
  instructions: string | null;
  isEnabled: boolean;
};

export default function AdminPaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethodConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    try {
      const data = await apiFetch<{ paymentMethods: PaymentMethodConfig[] }>("/api/admin/subscriptions/payment-methods");
      setMethods(data.paymentMethods);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      await load();
    }
    init();
  }, []);

  function updateLocal(method: string, patch: Partial<PaymentMethodConfig>) {
    setMethods((cur) => cur.map((m) => (m.method === method ? { ...m, ...patch } : m)));
  }

  async function save(m: PaymentMethodConfig) {
    setSaving(m.method);
    setError(null);
    try {
      await apiFetch("/api/admin/subscriptions/payment-methods", "PATCH", {
        method: m.method,
        displayName: m.displayName,
        instructions: m.instructions,
        isEnabled: m.isEnabled,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <main className="p-8 text-sm text-slate-600">Loading…</main>;

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-950">Payment methods</h1>
        <Link href="/admin/subscriptions" className="text-sm text-slate-600 hover:underline">
          ← Back to subscriptions
        </Link>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="space-y-4">
        {methods.map((m) => (
          <div key={m.method} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <input
                value={m.displayName}
                onChange={(e) => updateLocal(m.method, { displayName: e.target.value })}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-950"
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={m.isEnabled}
                  onChange={(e) => updateLocal(m.method, { isEnabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Payment instructions</span>
              <textarea
                value={m.instructions ?? ""}
                onChange={(e) => updateLocal(m.method, { instructions: e.target.value })}
                placeholder="e.g. Send money to 01XXXXXXXXX (Personal)"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                rows={2}
              />
            </label>
            <button
              type="button"
              onClick={() => save(m)}
              disabled={saving === m.method}
              className="mt-4 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving === m.method ? "Saving…" : "Save"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
