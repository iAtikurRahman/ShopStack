"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { type PartyPayment } from "@/components/PartyPayments";
import { useI18n } from "@/components/LocaleProvider";
import { PrintLetterhead } from "@/components/reports/PrintLetterhead";
import { apiFetch } from "@/services/api";
import type { ReportLetterhead } from "@/lib/reports/letterhead";

type Supplier = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  dueAmount: number;
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
  // "due" means nothing was paid and the whole total went onto the supplier's
  // balance; a bank name means it was settled at the till; null are legacy rows
  // recorded before the column existed.
  paymentMethod: string | null;
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

type Detail = {
  supplier: Supplier;
  purchases: Purchase[];
  supplierReturns: SupplierReturnRow[];
  payments: PartyPayment[];
  letterhead: ReportLetterhead | null;
};

/**
 * One row of the combined activity feed: a purchase, a return sent back to the
 * supplier, or a ledger payment. What we owe a supplier ("due", shown after
 * each row) rises when a delivery is booked on credit and falls when we pay,
 * when a paid delivery is settled, or when goods are returned - the balance is
 * allowed to dip below zero, which just means the supplier now owes us.
 */
type PurchaseEntry = {
  kind: "purchase";
  at: string;
  amount: number;
  impact: number;
  isOwed: boolean;
  purchase: Purchase;
  balanceAfter: number;
};
type ReturnEntry = {
  kind: "return";
  at: string;
  amount: number;
  impact: number;
  row: SupplierReturnRow;
  balanceAfter: number;
};
type PaymentEntry = {
  kind: "payment";
  at: string;
  amount: number;
  impact: number;
  payment: PartyPayment;
  balanceAfter: number;
};
type Entry = PurchaseEntry | ReturnEntry | PaymentEntry;

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, tEnum, fmt } = useI18n();
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

  /**
   * The feed: purchases, returns and the ledger payments, walked in date order.
   * The running balance starts before the oldest row and every event applies
   * its impact, so the bottom (newest) row lands exactly on the stored balance
   * the header shows - including any opening balance the supplier started with.
   */
  const timeline = useMemo(() => {
    const purchases = data?.purchases ?? [];
    const supplierReturns = data?.supplierReturns ?? [];
    const payments = data?.payments ?? [];
    const built: Array<Omit<PurchaseEntry, "balanceAfter"> | Omit<ReturnEntry, "balanceAfter"> | Omit<PaymentEntry, "balanceAfter">> =
      [];

    for (const purchase of purchases) {
      // A `due` purchase books nothing at the till, so the whole total lands on
      // what we owe the supplier. Legacy rows with no recorded method read the
      // same way - no proof of payment, so treat them as still owed.
      const isOwed = purchase.paymentMethod == null || purchase.paymentMethod.toLowerCase() === "due";
      const amount = Number(purchase.totalCost);
      built.push({ kind: "purchase", at: purchase.purchasedAt, amount, impact: isOwed ? amount : 0, isOwed, purchase });
    }
    for (const row of supplierReturns) {
      // Sending goods back means the supplier owes us that credit, so it always
      // lowers the running balance - whether the original delivery was credit
      // or paid. The balance may dip below zero, meaning they now owe us.
      const amount = Number(row.amount);
      built.push({ kind: "return", at: row.createdAt, amount, impact: -amount, row });
    }
    for (const payment of payments) {
      const amount = payment.paymentAmount;
      // For a supplier, receiving money back from them ADDS to what we owe, and
      // paying them REDUCES it (mirror of a customer, see DUE_DIRECTION).
      const impact = payment.isActive
        ? payment.transactionType === "receive"
          ? amount
          : -amount
        : 0;
      built.push({ kind: "payment", at: payment.paymentDate, amount, impact, payment });
    }

    const sorted = [...built].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const opening = (data?.supplier.dueAmount ?? 0) - sorted.reduce((sum, e) => sum + e.impact, 0);
    const withBalance = sorted.reduce<{ run: number; out: Entry[] }>(
      (acc, entry) => {
        const run = acc.run + entry.impact;
        return { run, out: [...acc.out, { ...entry, balanceAfter: Math.round(run * 100) / 100 }] };
      },
      { run: opening, out: [] }
    ).out;
    return [...withBalance].reverse();
  }, [data]);

  const warehouseText = (purchase: Purchase) =>
    purchase.warehouse
      ? `${purchase.warehouse.name} (${purchase.warehouse.store.name})`
      : [...new Set(purchase.items.map((i) => `${i.warehouse.name} (${i.warehouse.store.name})`))].join(", ");

  const unitsOf = (purchase: Purchase) => purchase.items.reduce((sum, item) => sum + item.quantity, 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return timeline;
    return timeline.filter((entry) => {
      if (entry.kind === "purchase") {
        const items = entry.purchase.items.map((i) => `${i.product.name} ${i.quantity}`).join(" ");
        return [
          String(entry.purchase.id),
          entry.purchase.reference ?? "",
          entry.purchase.totalCost,
          entry.purchase.purchasedAt,
          items,
          warehouseText(entry.purchase),
          "purchase",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      }
      if (entry.kind === "return") {
        return [
          String(entry.row.id),
          entry.row.product.name,
          String(entry.row.quantity),
          entry.row.amount,
          entry.row.warehouse.name,
          entry.row.warehouse.store.name,
          entry.row.reason ?? "",
          "return",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      }
      return [
        entry.payment.transactionId,
        entry.payment.paymentType,
        String(entry.payment.paymentAmount),
        entry.payment.paymentDate,
        "payment",
      ]
        .concat(entry.payment.description ?? [])
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [timeline, search]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8 print-root">
      <Link href="/company/suppliers" className="print-hide text-sm text-slate-600 hover:underline">
        {t("company.supplierDetail.backToSuppliers")}
      </Link>

      {loading ? (
        <p className="text-sm text-slate-600">{t("common.loading")}</p>
      ) : error || !data ? (
        <p className="text-sm text-red-600">{error ?? t("company.supplierDetail.notFound")}</p>
      ) : (
        <>
          <PrintLetterhead letterhead={data.letterhead} />

          <div className="print-letterhead rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-950">{data.supplier.name}</h1>
                <p className="mt-1 text-sm text-slate-600">
                  {[data.supplier.phone, data.supplier.email].filter(Boolean).join(" · ") ||
                    t("company.supplierDetail.noContact")}
                </p>
                {data.supplier.dueAmount > 0 ? (
                  <p className="mt-1 text-sm font-semibold text-amber-700">
                    {t("company.suppliers.dueOwed", {
                      amount: fmt.number(data.supplier.dueAmount, { decimals: 2 }),
                    })}
                  </p>
                ) : null}
                {data.supplier.address ? (
                  <p className="mt-0.5 text-xs text-slate-500">{data.supplier.address}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-slate-400">
                  {t("company.supplierDetail.supplierSince", {
                    date: fmt.date(data.supplier.createdAt),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    data.supplier.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {data.supplier.isActive ? t("common.active") : t("common.inactive")}
                </span>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="no-print rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {t("reports.ui.print")}
                </button>
              </div>
            </div>
          </div>

          <div className="print-hide grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("nav.purchases")}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.number(stats.purchaseCount)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {stats.lastPurchaseAt
                  ? t("company.supplierDetail.lastOn", {
                      date: fmt.date(stats.lastPurchaseAt),
                    })
                  : t("company.supplierDetail.noPurchases")}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("company.supplierDetail.totalPurchased")}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.money(stats.totalCost)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {stats.units === 1
                  ? t("company.supplierDetail.avgOne", {
                      amount: fmt.number(stats.averageCost, { decimals: 2 }),
                    })
                  : t("company.supplierDetail.avgMany", {
                      amount: fmt.number(stats.averageCost, { decimals: 2 }),
                      count: fmt.quantity(stats.units),
                    })}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("company.supplierDetail.returnedToSupplier")}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.money(stats.returnedAmount)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {stats.returnedUnits === 1
                  ? t("company.supplierDetail.sentBackOne")
                  : t("company.supplierDetail.sentBackMany", { count: fmt.quantity(stats.returnedUnits) })}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("company.supplierDetail.timelineTitle")}
              </h2>
              <p className="text-sm text-slate-500">
                {filtered.length === 1
                  ? t("company.supplierDetail.entryCountOne")
                  : t("company.supplierDetail.entryCountMany", { count: fmt.number(filtered.length) })}
              </p>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("company.supplierDetail.timelineSearchPlaceholder")}
              className="print-hide mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
            />

            {filtered.length === 0 ? (
              <p className="mt-6 text-sm text-slate-600">
                {search.trim()
                  ? t("company.supplierDetail.noActivityMatch", { search: search.trim() })
                  : t("company.supplierDetail.noneYetActivity")}
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {filtered.map((entry) => {
                  const tagStyle =
                    entry.kind === "return"
                      ? "bg-red-50 text-red-700"
                      : entry.kind === "payment"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-700";

                  if (entry.kind === "purchase") {
                    const { purchase, isOwed } = entry;
                    const units = unitsOf(purchase);
                    const place = warehouseText(purchase);
                    return (
                      <li
                        key={`purchase-${purchase.id}`}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300 print:break-inside-avoid"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagStyle}`}>
                              {t("company.supplierDetail.typePurchase")}
                            </span>
                            <span className="font-semibold text-slate-950">
                              {t("company.supplierDetail.purchaseLabel", { id: fmt.number(purchase.id) })}
                              {purchase.reference ? ` · ${purchase.reference}` : ""}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {units === 1
                              ? t("company.supplierDetail.metaOne", {
                                  date: fmt.dateTime(purchase.purchasedAt),
                                })
                              : t("company.supplierDetail.metaMany", {
                                  date: fmt.dateTime(purchase.purchasedAt),
                                  count: fmt.quantity(units),
                                })}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">{place}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {purchase.items
                              .map(
                                (item) =>
                                  `${item.product.name} ×${fmt.quantity(item.quantity)}@${fmt.money(item.unitCost)}`
                              )
                              .join(", ")}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-slate-950">{fmt.money(purchase.totalCost)}</p>
                          <p className={`text-xs ${isOwed ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                            {isOwed
                              ? t("company.supplierDetail.purchaseOnCredit")
                              : t("company.supplierDetail.purchasePaid")}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {t("company.supplierDetail.balanceAfter", {
                              amount: fmt.number(entry.balanceAfter, { decimals: 2 }),
                            })}
                          </p>
                        </div>
                      </li>
                    );
                  }

                  if (entry.kind === "return") {
                    const { row } = entry;
                    return (
                      <li
                        key={`return-${row.id}`}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-red-100 bg-red-50/50 p-4 transition hover:border-red-300 print:break-inside-avoid"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagStyle}`}>
                              {t("company.supplierDetail.typeReturn")}
                            </span>
                            <span className="font-semibold text-slate-950">{row.product.name}</span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {row.quantity === 1
                              ? t("company.supplierDetail.unitsOne")
                              : t("company.supplierDetail.unitsMany", { count: fmt.quantity(row.quantity) })}
                            {" · "}
                            {row.warehouse.name} ({row.warehouse.store.name})
                          </p>
                          {row.reason ? <p className="mt-1 text-xs text-slate-600">{row.reason}</p> : null}
                          <p className="mt-0.5 text-xs text-slate-400">{fmt.dateTime(row.createdAt)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-red-600">-{fmt.money(row.amount)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {t("company.supplierDetail.balanceAfter", {
                              amount: fmt.number(entry.balanceAfter, { decimals: 2 }),
                            })}
                          </p>
                        </div>
                      </li>
                    );
                  }

                  const { payment } = entry;
                  // "receive" means the supplier refunded money back to us
                  // (adds to what we owe them), "payment" means we paid them.
                  const incoming = payment.transactionType === "receive";
                  return (
                    <li
                      key={`payment-${payment.id}`}
                      className={`flex flex-wrap items-start justify-between gap-4 rounded-2xl border p-4 print:break-inside-avoid ${
                        payment.isActive ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white opacity-70"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagStyle}`}>
                            {t("company.supplierDetail.typePayment")}
                          </span>
                          <span className="font-semibold text-slate-950">{payment.transactionId}</span>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {fmt.dateTime(payment.paymentDate)}
                          {" · "}
                          {t(
                            payment.transactionType === "receive"
                              ? "common.payments.receive"
                              : "common.payments.payOut"
                          )}
                          {" · "}
                          {tEnum(payment.paymentType)}
                          {payment.isActive ? null : ` · ${t("common.payments.voided")}`}
                        </p>
                        {payment.description ? (
                          <p className="mt-1 text-xs text-slate-600">{payment.description}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={`font-semibold ${
                            !payment.isActive
                              ? "text-slate-500 line-through"
                              : incoming
                                ? "text-emerald-700"
                                : "text-red-600"
                          }`}
                        >
                          {incoming ? "+" : "-"}
                          {fmt.money(payment.paymentAmount)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {t("company.supplierDetail.balanceAfter", {
                            amount: fmt.number(entry.balanceAfter, { decimals: 2 }),
                          })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}
    </main>
  );
}