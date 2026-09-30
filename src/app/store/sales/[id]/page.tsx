"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type SaleItem = { id: number; productId: number; quantity: number; unitPrice: string; lineTotal: string };
type SalePayment = { id: number; method: string; amount: string };
type ReturnItem = { id: number; saleItemId: number; quantity: number };
type ReturnRow = { id: number; refundAmount: string; createdAt: string; items: ReturnItem[] };
type Sale = {
  id: number;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  status: string;
  createdAt: string;
  items: SaleItem[];
  payments: SalePayment[];
  returns: ReturnRow[];
  customer: { name: string } | null;
};

export default function SaleReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, tEnum, fmt } = useI18n();
  const { id } = use(params);
  const [sale, setSale] = useState<Sale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<{ sale: Sale }>(`/api/store/sales/${id}`);
        setSale(data.sale);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <Link href="/store/sales" className="text-sm text-slate-600 hover:underline">
        {t("storeOps.saleDetail.backToSales")}
      </Link>

      {loading ? (
        <p className="text-sm text-slate-600">{t("common.loading")}</p>
      ) : error || !sale ? (
        <p className="text-sm text-red-600">{error ?? t("storeOps.saleDetail.notFound")}</p>
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-slate-950">
              {t("storeOps.saleDetail.receipt", { id: sale.id })}
            </h1>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{tEnum(sale.status)}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {sale.customer?.name ?? t("storeOps.saleDetail.walkIn")}
          </p>

          <table className="mt-6 w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2">{t("storeOps.saleDetail.product")}</th>
                <th className="pb-2">{t("storeOps.saleDetail.qty")}</th>
                <th className="pb-2">{t("storeOps.saleDetail.unitPrice")}</th>
                <th className="pb-2">{t("storeOps.saleDetail.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-2 text-slate-600">
                    {t("storeOps.saleDetail.productRow", { id: item.productId })}
                  </td>
                  <td className="py-2 text-slate-600">{fmt.quantity(item.quantity)}</td>
                  <td className="py-2 text-slate-600">{fmt.money(item.unitPrice)}</td>
                  <td className="py-2 text-slate-950">{fmt.money(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 space-y-1 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>{t("storeOps.saleDetail.subtotal")}</span>
              <span>{fmt.money(sale.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("storeOps.saleDetail.discount")}</span>
              <span>-{fmt.money(sale.discountAmount)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("storeOps.saleDetail.tax")}</span>
              <span>{fmt.money(sale.taxAmount)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold text-slate-950">
              <span>{t("common.total")}</span>
              <span>{fmt.money(sale.totalAmount)}</span>
            </div>
          </div>

          <div className="mt-4 text-sm text-slate-500">
            {t("storeOps.saleDetail.paidVia", {
              methods: sale.payments.map((p) => `${tEnum(p.method)} (${fmt.money(p.amount)})`).join(", "),
            })}
          </div>

          {sale.returns.length > 0 ? (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <p className="text-sm font-semibold text-slate-950">{t("nav.returns")}</p>
              {sale.returns.map((r) => (
                <p key={r.id} className="mt-1 text-sm text-slate-600">
                  {t("storeOps.saleDetail.refunded", {
                    amount: fmt.number(r.refundAmount, { decimals: 2 }),
                    date: fmt.date(r.createdAt),
                  })}
                </p>
              ))}
            </div>
          ) : null}

          {sale.status !== "refunded" ? (
            <Link
              href={`/store/returns?saleId=${sale.id}`}
              className="mt-6 inline-flex items-center justify-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              {t("storeOps.saleDetail.processReturn")}
            </Link>
          ) : null}
        </div>
      )}
    </main>
  );
}
