"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/services/api";

type Payment = {
  id: number;
  paymentMethod: string;
  transactionId: string;
  amount: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  company: { id: number; name: string; slug: string };
  plan: { id: number; name: string; durationDays: number } | null;
};

type Subscription = {
  id: number;
  status: "pending" | "active" | "expired" | "cancelled";
  paymentMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  company: { id: number; name: string; slug: string };
  plan: { id: number; name: string } | null;
};

const STATUS_BADGE: Record<string, string> = {
  active: "🟢 active",
  pending: "🟡 pending",
  expired: "⚫ expired",
  cancelled: "🔴 cancelled",
};

export default function AdminSubscriptionsPage() {
  const [pending, setPending] = useState<Payment[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Record<number, { status: string; endDate: string }>>({});

  async function loadAll() {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (methodFilter) params.set("paymentMethod", methodFilter);

      const [pendingData, subsData] = await Promise.all([
        apiFetch<{ payments: Payment[] }>("/api/admin/subscriptions/payments?status=pending"),
        apiFetch<{ subscriptions: Subscription[] }>(`/api/admin/subscriptions?${params.toString()}`),
      ]);
      setPending(pendingData.payments);
      setSubscriptions(subsData.subscriptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadAll();
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, methodFilter]);

  async function review(id: number, action: "approve" | "reject") {
    setError(null);
    try {
      await apiFetch(`/api/admin/subscriptions/payments/${id}`, "POST", {
        action,
        note: reviewNotes[id] || undefined,
      });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit(sub: Subscription) {
    setEditing((cur) => ({
      ...cur,
      [sub.id]: { status: sub.status, endDate: sub.endDate ? sub.endDate.slice(0, 10) : "" },
    }));
  }

  async function saveEdit(id: number) {
    const edit = editing[id];
    if (!edit) return;
    setError(null);
    try {
      await apiFetch(`/api/admin/subscriptions/${id}`, "PATCH", {
        status: edit.status,
        endDate: edit.endDate || null,
      });
      setEditing((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <main className="p-8 text-sm text-slate-400">Loading…</main>;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-950">Subscriptions</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/admin/subscriptions/plans" className="rounded-2xl border border-slate-300 px-4 py-2 hover:bg-white">
            Plans
          </Link>
          <Link
            href="/admin/subscriptions/payment-methods"
            className="rounded-2xl border border-slate-300 px-4 py-2 hover:bg-white"
          >
            Payment methods
          </Link>
          <Link
            href="/admin/subscriptions/ad-settings"
            className="rounded-2xl border border-slate-300 px-4 py-2 hover:bg-white"
          >
            Ad settings
          </Link>
          <Link
            href="/api/admin/subscriptions/export"
            className="rounded-2xl bg-slate-950 px-4 py-2 text-white hover:bg-slate-800"
          >
            Export CSV
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Pending payments ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">Nothing waiting for review.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {pending.map((p) => (
              <div key={p.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-950">
                    {p.company.name} — {p.plan?.name ?? "—"} · ৳{p.amount}
                  </p>
                  <p className="text-slate-600">
                    {p.paymentMethod} · TX: {p.transactionId}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    placeholder="Note (optional)"
                    value={reviewNotes[p.id] ?? ""}
                    onChange={(e) => setReviewNotes((cur) => ({ ...cur, [p.id]: e.target.value }))}
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => review(p.id, "approve")}
                    className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => review(p.id, "reject")}
                    className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-950">All subscriptions</h2>
          <div className="flex gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm"
            >
              <option value="">All methods</option>
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
              <option value="rocket">Rocket</option>
            </select>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2">Company</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Plan</th>
                <th className="pb-2">End date</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-950">{sub.company.name}</td>
                  <td className="py-2 text-slate-600">
                    {editing[sub.id] ? (
                      <select
                        value={editing[sub.id].status}
                        onChange={(e) =>
                          setEditing((cur) => ({ ...cur, [sub.id]: { ...cur[sub.id], status: e.target.value } }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="pending">pending</option>
                        <option value="active">active</option>
                        <option value="expired">expired</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    ) : (
                      STATUS_BADGE[sub.status] ?? sub.status
                    )}
                  </td>
                  <td className="py-2 text-slate-600">{sub.plan?.name ?? "—"}</td>
                  <td className="py-2 text-slate-600">
                    {editing[sub.id] ? (
                      <input
                        type="date"
                        value={editing[sub.id].endDate}
                        onChange={(e) =>
                          setEditing((cur) => ({ ...cur, [sub.id]: { ...cur[sub.id], endDate: e.target.value } }))
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      />
                    ) : sub.endDate ? (
                      new Date(sub.endDate).toLocaleDateString()
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {editing[sub.id] ? (
                      <button
                        type="button"
                        onClick={() => saveEdit(sub.id)}
                        className="rounded-lg bg-slate-950 px-3 py-1 text-xs font-semibold text-white"
                      >
                        Save
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(sub)}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
