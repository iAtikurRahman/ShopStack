"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Customer = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  loyaltyPoints: number;
  createdAt: string;
};
type SaleItem = { id: number; productId: number; quantity: number; unitPrice: string; lineTotal: string };
type Sale = {
  id: number;
  status: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  createdAt: string;
  items: SaleItem[];
  returns: { id: number; refundAmount: string }[];
};
type Product = { id: number; name: string };

type Detail = { customer: Customer; sales: Sale[]; products: Product[] };

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, fmt } = useI18n();
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

  const filteredSales = useMemo(() => {
    const sales = data?.sales ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    const digits = q.replace(/\D/g, "");
    return sales.filter((sale) => {
      const searchable = sale.items.map((i) => productNames.get(i.productId) ?? `product ${i.productId}`);
      return (
        String(sale.id).includes(q) ||
        sale.status.toLowerCase().includes(q) ||
        sale.createdAt.slice(0, 10).includes(q) ||
        sale.totalAmount.includes(q) ||
        searchable.some((name) => name.toLowerCase().includes(q)) ||
        (digits.length > 0 && sale.totalAmount.replace(/\D/g, "").includes(digits))
      );
    });
  }, [data, search, productNames]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <Link href="/store/customers" className="text-sm text-slate-600 hover:underline">
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
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-950">{data.customer.name}</h1>
                <p className="mt-1 text-sm text-slate-600">
                  {data.customer.phone
                    ? `${t("common.phone")}: ${data.customer.phone}`
                    : t("storeCommerce.customerDetail.noPhone")}
                  {data.customer.email ? ` · ${data.customer.email}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {t("storeCommerce.customerDetail.customerSince", {
                    date: fmt.date(data.customer.createdAt),
                  })}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {t("storeCommerce.customers.points", { points: fmt.number(data.customer.loyaltyPoints) })}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
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
                {t("storeCommerce.customerDetail.purchaseHistory")}
              </h2>
              <p className="text-sm text-slate-500">
                {filteredSales.length === 1
                  ? t("storeCommerce.customerDetail.saleCountOne")
                  : t("storeCommerce.customerDetail.saleCountMany", { count: fmt.number(filteredSales.length) })}
              </p>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("storeCommerce.customerDetail.searchPlaceholder")}
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
            />

            {filteredSales.length === 0 ? (
              <p className="mt-6 text-sm text-slate-600">
                {search.trim()
                  ? t("storeCommerce.customerDetail.noMatch", { search: search.trim() })
                  : t("storeCommerce.customerDetail.noneYet")}
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {filteredSales.map((sale) => {
                  const units = sale.items.reduce((sum, item) => sum + item.quantity, 0);
                  const refunded = sale.returns.reduce((sum, r) => sum + Number(r.refundAmount), 0);
                  return (
                    <Link
                      key={sale.id}
                      href={`/store/sales/${sale.id}`}
                      className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300"
                    >
                      <div>
                        <p className="font-semibold text-slate-950">
                          {t("storeCommerce.customerDetail.saleLabel", { id: sale.id })}
                        </p>
                        <p className="text-xs text-slate-500">
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
                        {refunded > 0 ? (
                          <p className="mt-1 text-xs text-red-600">
                            {t("storeCommerce.customerDetail.refundedAmount", {
                              amount: fmt.number(refunded, { decimals: 2 }),
                            })}
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-medium text-slate-950">{fmt.money(sale.totalAmount)}</p>
                        <p className="text-xs text-slate-500">
                          {t("storeCommerce.customerDetail.subtotalLabel", {
                            amount: fmt.number(sale.subtotal, { decimals: 2 }),
                          })}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
