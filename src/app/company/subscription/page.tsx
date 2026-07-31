"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type SubscriptionStatus = {
  status: "pending" | "active" | "expired" | "cancelled" | "none";
  isPremium: boolean;
  daysRemaining: number | null;
  startDate: string | null;
  endDate: string | null;
  plan: { id: number; name: string; price: string; durationDays: number } | null;
};

type Plan = { id: number; name: string; price: string; durationDays: number; duration: string };
type PaymentMethodConfig = { method: string; displayName: string; instructions: string | null };
type Payment = {
  id: number;
  paymentMethod: string;
  transactionId: string;
  amount: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
  plan: { name: string } | null;
};
type Notification = { id: number; type: string; message: string; isRead: boolean; createdAt: string };

const BADGE: Record<string, string> = {
  active_ok: "🟢 Premium",
  active_soon: "🟡 Expiring Soon",
  expired: "⚫ Expired",
  free: "🔴 Free",
};

function badgeFor(status: SubscriptionStatus): string {
  if (status.status === "active") {
    return status.daysRemaining !== null && status.daysRemaining <= 7 ? BADGE.active_soon : BADGE.active_ok;
  }
  if (status.status === "expired") return BADGE.expired;
  return BADGE.free;
}

export default function CompanySubscriptionPage() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [methods, setMethods] = useState<PaymentMethodConfig[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [planId, setPlanId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [amount, setAmount] = useState("");
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [statusData, plansData, methodsData, paymentsData, notificationsData] = await Promise.all([
        apiFetch<{ subscription: SubscriptionStatus }>("/api/company/subscription/status"),
        apiFetch<{ plans: Plan[] }>("/api/company/subscription/plans"),
        apiFetch<{ paymentMethods: PaymentMethodConfig[] }>("/api/company/subscription/payment-methods"),
        apiFetch<{ payments: Payment[] }>("/api/company/subscription/payments"),
        apiFetch<{ notifications: Notification[] }>("/api/company/notifications"),
      ]);
      setStatus(statusData.subscription);
      setFetchedAt(Date.now());
      setPlans(plansData.plans);
      setMethods(methodsData.paymentMethods);
      setPayments(paymentsData.payments);
      setNotifications(notificationsData.notifications);
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
  }, []);

  function handleScreenshotChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setScreenshotBase64(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setScreenshotBase64(reader.result as string);
    reader.readAsDataURL(file);
  }

  function handlePlanChange(id: string) {
    setPlanId(id);
    const plan = plans.find((p) => String(p.id) === id);
    if (plan) setAmount(plan.price);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/company/subscription/payments", "POST", {
        planId: Number(planId),
        paymentMethod,
        transactionId,
        amount: Number(amount),
        screenshotBase64,
      });
      setPlanId("");
      setPaymentMethod("");
      setTransactionId("");
      setAmount("");
      setScreenshotBase64(null);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function markRead(id: number) {
    try {
      await apiFetch("/api/company/notifications", "PATCH", { id });
      await loadAll();
    } catch {
      // Non-critical - leave it unread if this fails.
    }
  }

  if (loading) return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  if (error || !status) return <main className="p-8 text-sm text-red-600">{error ?? "Not available"}</main>;

  const progressPercent =
    status.status === "active" && status.startDate && status.endDate
      ? Math.min(
          100,
          Math.max(
            0,
            ((fetchedAt - new Date(status.startDate).getTime()) /
              (new Date(status.endDate).getTime() - new Date(status.startDate).getTime())) *
              100
          )
        )
      : null;

  const selectedMethod = methods.find((m) => m.method === paymentMethod);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Subscription</h1>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-slate-950">{badgeFor(status)}</p>
            {status.plan ? <p className="mt-1 text-sm text-slate-600">Plan: {status.plan.name}</p> : null}
          </div>
          <div className="text-right text-sm text-slate-600">
            {status.daysRemaining !== null ? <p>{Math.max(status.daysRemaining, 0)} days remaining</p> : null}
            {status.endDate ? <p>Expires {new Date(status.endDate).toLocaleDateString()}</p> : null}
          </div>
        </div>
        {progressPercent !== null ? (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-950" style={{ width: `${progressPercent}%` }} />
          </div>
        ) : null}
      </div>

      {notifications.length > 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Notifications</h2>
          <div className="mt-4 space-y-2">
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => markRead(n.id)}
                className={`block w-full rounded-2xl border p-3 text-left text-sm ${
                  n.isRead ? "border-slate-100 bg-slate-50 text-slate-500" : "border-slate-300 bg-white text-slate-900"
                }`}
              >
                {n.message}
                <span className="ml-2 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Renew / subscribe</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Plan</span>
              <select
                required
                value={planId}
                onChange={(e) => handlePlanChange(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">Select plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ৳{p.price} / {p.durationDays}d
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Payment method</span>
              <select
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">Select method</option>
                {methods.map((m) => (
                  <option key={m.method} value={m.method}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            {selectedMethod?.instructions ? (
              <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{selectedMethod.instructions}</p>
            ) : null}
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Transaction ID</span>
              <input
                required
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Amount paid</span>
              <input
                required
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Payment screenshot (optional)</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleScreenshotChange}
                className="mt-2 w-full text-sm"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit payment"}
            </button>
          </form>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Payment history</h2>
          {payments.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No payments submitted yet.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {payments.map((p) => (
                <div key={p.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-950">
                      {p.plan?.name ?? "—"} · ৳{p.amount}
                    </p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        p.status === "approved"
                          ? "bg-emerald-100 text-emerald-700"
                          : p.status === "rejected"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {p.paymentMethod} · TX: {p.transactionId}
                  </p>
                  {p.reviewNote ? <p className="mt-1 text-xs text-slate-500">{p.reviewNote}</p> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
