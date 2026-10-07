"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { type PartyPayment } from "@/components/PartyPayments";
import { useI18n } from "@/components/LocaleProvider";
import { PrintLetterhead } from "@/components/reports/PrintLetterhead";
import { apiFetch } from "@/services/api";
import type { ReportLetterhead } from "@/lib/reports/letterhead";

type Customer = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  loyaltyPoints: number;
  dueAmount: number;
  createdAt: string;
};
type SaleItem = { id: number; productId: number; quantity: number; unitPrice: string; lineTotal: string };
type SalePayment = { id: number; method: string; amount: string; reference: string | null };
type Return = { id: number; saleId: number; refundAmount: string; reason: string | null; createdAt: string };
type Sale = {
  id: number;
  status: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  createdAt: string;
  items: SaleItem[];
  payments: SalePayment[];
  returns: Return[];
};
type Product = { id: number; name: string };

type Detail = {
  customer: Customer;
  sales: Sale[];
  products: Product[];
  payments: PartyPayment[];
  letterhead: ReportLetterhead | null;
};

/**
 * One row of the combined activity feed: a sale, a refund against a sale, or a
 * ledger payment. Every sale is either fully settled at the till (it has tender
 * rows) or booked on credit (it has none); refunds and payments only move the
 * running due when the thing being undone was itself owed.
 */
type SaleEntry = {
  kind: "sale";
  at: string;
  amount: number;
  impact: number;
  isDue: boolean;
  sale: Sale;
  dueAfter: number;
};
type RefundEntry = {
  kind: "refund";
  at: string;
  amount: number;
  impact: number;
  sale: Sale;
  refund: Return;
  dueAfter: number;
};
type PaymentEntry = {
  kind: "payment";
  at: string;
  amount: number;
  impact: number;
  payment: PartyPayment;
  dueAfter: number;
};
type Entry = SaleEntry | RefundEntry | PaymentEntry;

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, tEnum, fmt } = useI18n();
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
        const res = await apiFetch<Detail>(`/api/store/customers/${id}`);
        setData(res);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const productNames = useMemo(() => {
    const map = new Map<number, string>();
    (data?.products ?? []).forEach((p) => map.set(p.id, p.name));
    return map;
  }, [data]);

  const stats = useMemo(() => {
    const sales = data?.sales ?? [];
    const totalSpent = sales.reduce((sum, sale) => sum + Number(sale.totalAmount), 0);
    const totalRefunded = sales.reduce(
      (sum, sale) => sum + sale.returns.reduce((s, r) => s + Number(r.refundAmount), 0),
      0
    );
    const units = sales.reduce((sum, sale) => sum + sale.items.reduce((s, i) => s + i.quantity, 0), 0);

    return {
      saleCount: sales.length,
      totalSpent,
      totalRefunded,
      units,
      averageBasket: sales.length > 0 ? totalSpent / sales.length : 0,
      lastPurchaseAt: sales.length > 0 ? sales[0].createdAt : null,
    };
  }, [data]);

  /**
   * The feed: sales, their refunds and the ledger payments, walked in date
   * order. The running due starts before the oldest row and every event applies
   * its impact, so the bottom (newest) row lands exactly on the stored balance
   * the header shows - including any opening due the customer started with.
   */
  const timeline = useMemo(() => {
    const sales = data?.sales ?? [];
    const payments = data?.payments ?? [];
    const built: Array<Omit<SaleEntry, "dueAfter"> | Omit<RefundEntry, "dueAfter"> | Omit<PaymentEntry, "dueAfter">> =
      [];

    for (const sale of sales) {
      // A credit sale never writes a real tender row. Some legacy sales instead
      // stored the method itself as "due", so either shape still counts as owed.
      const isDue =
        sale.payments.length === 0 || sale.payments.every((p) => p.method.toLowerCase() === "due");
      const amount = Number(sale.totalAmount);
      built.push({ kind: "sale", at: sale.createdAt, amount, impact: isDue ? amount : 0, isDue, sale });
      for (const refund of sale.returns) {
        const amt = Number(refund.refundAmount);
        // A refund returns money whether the sale was credit or paid, so it
        // always lowers the running balance. The balance itself may dip below
        // zero, which simply means the store now owes that much back.
        built.push({ kind: "refund", at: refund.createdAt, amount: amt, impact: -amt, sale, refund });
      }
    }
    for (const payment of payments) {
      const amount = payment.paymentAmount;
      const impact = payment.isActive
        ? payment.transactionType === "receive"
          ? -amount
          : amount
        : 0;
      built.push({ kind: "payment", at: payment.paymentDate, amount, impact, payment });
    }

    const sorted = [...built].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const opening = (data?.customer.dueAmount ?? 0) - sorted.reduce((sum, e) => sum + e.impact, 0);
    const withDue = sorted.reduce<{ run: number; out: Entry[] }>(
      (acc, entry) => {
        const run = acc.run + entry.impact;
        return { run, out: [...acc.out, { ...entry, dueAfter: Math.round(run * 100) / 100 }] };
      },
      { run: opening, out: [] }
    ).out;
    return [...withDue].reverse();
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return timeline;
    return timeline.filter((entry) => {
      if (entry.kind === "sale") {
        const items = entry.sale.items
          .map((i) => `${productNames.get(i.productId) ?? `product ${i.productId}`} ${i.quantity}`)
          .join(" ");
        return [String(entry.sale.id), entry.sale.status, entry.sale.totalAmount, entry.sale.createdAt, items, "sale"]
          .join(" ")
          .toLowerCase()
          .includes(q);
      }
      if (entry.kind === "refund") {
        return [String(entry.refund.id), String(entry.refund.saleId), entry.refund.refundAmount, "refund"]
          .concat(entry.refund.reason ?? [])
          .join(" ")
          .toLowerCase()
          .includes(q);
      }
      return [entry.payment.transactionId, entry.payment.paymentType, String(entry.payment.paymentAmount), "payment"]
        .concat(entry.payment.description ?? [])
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [timeline, search, productNames]);

  const unitsOf = (sale: Sale) => sale.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8 print-root">
      <Link href="/store/customers" className="print-hide text-sm text-slate-600 hover:underline">
        {t("storeCommerce.customerDetail.backToCustomers")}
      </Link>

      {loading ? (
        <p className="text-sm text-slate-600">{t("common.loading")}</p>
      ) : error || !data ? (
        <p className="text-sm text-red-600">
          {error ?? t("storeCommerce.customerDetail.notFound")}
        </p>
      ) : (
        <>
          <PrintLetterhead letterhead={data.letterhead} />

          <div className="print-letterhead rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-950">{data.customer.name}</h1>
                <p className="mt-1 text-sm text-slate-600">
                  {data.customer.phone
                    ? `${t("common.phone")}: ${data.customer.phone}`
                    : t("storeCommerce.customerDetail.noPhone")}
                  {data.customer.email ? ` · ${data.customer.email}` : ""}
                </p>
                {data.customer.dueAmount > 0 ? (
                  <p className="mt-1 text-sm font-semibold text-amber-700">
                    {t("storeCommerce.customers.dueOwed", {
                      amount: fmt.number(data.customer.dueAmount, { decimals: 2 }),
                    })}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-slate-400">
                  {t("storeCommerce.customerDetail.customerSince", {
                    date: fmt.date(data.customer.createdAt),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {t("storeCommerce.customers.points", { points: fmt.number(data.customer.loyaltyPoints) })}
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
              <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.number(stats.saleCount)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {stats.lastPurchaseAt
                  ? t("storeCommerce.customerDetail.lastOn", {
                      date: fmt.date(stats.lastPurchaseAt),
                    })
                  : t("storeCommerce.customerDetail.noPurchases")}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("storeCommerce.customerDetail.totalSpent")}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.money(stats.totalSpent)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {stats.units === 1
                  ? t("storeCommerce.customerDetail.avgBasketOne", {
                      amount: fmt.number(stats.averageBasket, { decimals: 2 }),
                    })
                  : t("storeCommerce.customerDetail.avgBasketMany", {
                      amount: fmt.number(stats.averageBasket, { decimals: 2 }),
                      count: fmt.quantity(stats.units),
                    })}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-600">{t("storeCommerce.customerDetail.refunded")}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.money(stats.totalRefunded)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {t("storeCommerce.customerDetail.netSpent", {
                  amount: fmt.number(stats.totalSpent - stats.totalRefunded, { decimals: 2 }),
                })}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("storeCommerce.customerDetail.timelineTitle")}
              </h2>
              <p className="text-sm text-slate-500">
                {filtered.length === 1
                  ? t("storeCommerce.customerDetail.entryCountOne")
                  : t("storeCommerce.customerDetail.entryCountMany", { count: fmt.number(filtered.length) })}
              </p>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("storeCommerce.customerDetail.timelineSearchPlaceholder")}
              className="print-hide mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
            />

            {filtered.length === 0 ? (
              <p className="mt-6 text-sm text-slate-600">
                {search.trim()
                  ? t("storeCommerce.customerDetail.noActivityMatch", { search: search.trim() })
                  : t("storeCommerce.customerDetail.noneYetActivity")}
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {filtered.map((entry) => {
                  const tagStyle =
                    entry.kind === "refund"
                      ? "bg-red-50 text-red-700"
                      : entry.kind === "payment"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-700";

                  if (entry.kind === "sale") {
                    const { sale, isDue } = entry;
                    const units = unitsOf(sale);
                    return (
                      <li
                        key={`sale-${sale.id}`}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300 print:break-inside-avoid"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagStyle}`}>
                              {t("storeCommerce.customerDetail.typeSale")}
                            </span>
                            <Link href={`/store/sales/${sale.id}`} className="font-semibold text-slate-950 hover:underline">
                              {t("storeCommerce.customerDetail.saleLabel", { id: sale.id })}
                            </Link>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {units === 1
                              ? t("storeCommerce.customerDetail.saleMetaOne", {
                                  date: fmt.dateTime(sale.createdAt),
                                  status: sale.status,
                                })
                              : t("storeCommerce.customerDetail.saleMetaMany", {
                                  date: fmt.dateTime(sale.createdAt),
                                  count: fmt.quantity(units),
                                  status: sale.status,
                                })}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {sale.items
                              .map(
                                (item) =>
                                  `${
                                    productNames.get(item.productId) ??
                                    t("storeCommerce.customerDetail.productFallback", { id: item.productId })
                                  } ×${fmt.quantity(item.quantity)}`
                              )
                              .join(", ")}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-slate-950">{fmt.money(sale.totalAmount)}</p>
                          <p className={`text-xs ${isDue ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                            {isDue
                              ? t("storeCommerce.customerDetail.saleOnCredit")
                              : t("storeCommerce.customerDetail.salePaid")}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {t("storeCommerce.customerDetail.dueAfter", { amount: fmt.number(entry.dueAfter, { decimals: 2 }) })}
                          </p>
                        </div>
                      </li>
                    );
                  }

                  if (entry.kind === "refund") {
                    const { refund } = entry;
                    return (
                      <li
                        key={`refund-${refund.id}`}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-red-100 bg-red-50/50 p-4 transition hover:border-red-300 print:break-inside-avoid"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tagStyle}`}>
                              {t("storeCommerce.customerDetail.typeRefund")}
                            </span>
                            <Link href={`/store/sales/${refund.saleId}`} className="font-semibold text-slate-950 hover:underline">
                              {t("storeCommerce.customerDetail.refundOnSale", { id: refund.saleId })}
                            </Link>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{fmt.dateTime(refund.createdAt)}</p>
                          {refund.reason ? (
                            <p className="mt-1 text-xs text-slate-600">{refund.reason}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-red-600">-{fmt.money(refund.refundAmount)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {t("storeCommerce.customerDetail.dueAfter", { amount: fmt.number(entry.dueAfter, { decimals: 2 }) })}
                          </p>
                        </div>
                      </li>
                    );
                  }

                  const { payment } = entry;
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
                            {t("storeCommerce.customerDetail.typePayment")}
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
                          {t("storeCommerce.customerDetail.dueAfter", { amount: fmt.number(entry.dueAfter, { decimals: 2 }) })}
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