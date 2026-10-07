"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
};

export default function StoreCustomersPage() {
  const { t, fmt } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [letterhead, setLetterhead] = useState<ReportLetterhead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Opening balance the customer already owed us. Defaults to 0; the field
  // stays optional, so clearing it also records no due.
  const [previousDue, setPreviousDue] = useState("0");
  const [search, setSearch] = useState("");

  async function loadCustomers() {
    try {
      const data = await apiFetch<{ customers: Customer[]; letterhead: ReportLetterhead | null }>(
        "/api/store/customers"
      );
      setCustomers(data.customers);
      setLetterhead(data.letterhead);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadCustomers();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/store/customers", "POST", {
        name,
        phone: phone || null,
        email: email || null,
        previousDue: previousDue === "" ? undefined : Number(previousDue),
      });
      setName("");
      setPhone("");
      setEmail("");
      setPreviousDue("0");
      await loadCustomers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const digits = q.replace(/\D/g, "");
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && (c.phone ?? "").replace(/\D/g, "").includes(digits))
      );
    });
  }, [customers, search]);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8 print-root">
      <PrintLetterhead letterhead={letterhead} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-950">{t("nav.customers")}</h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="no-print rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {t("reports.ui.print")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] print:block">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("storeCommerce.customers.allTitle")}
          </h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("storeCommerce.customers.searchPlaceholder")}
            className="print-hide mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredCustomers.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("storeCommerce.customers.noMatch", { search: search.trim() })
                : t("storeCommerce.customers.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredCustomers.map((customer) => (
                <Link
                  key={customer.id}
                  href={`/store/customers/${customer.id}`}
                  className="block rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300 print:break-inside-avoid"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-950">{customer.name}</p>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        customer.dueAmount > 0
                          ? "text-sm text-amber-700"
                          : customer.dueAmount < 0
                            ? "text-sm text-emerald-700"
                            : "text-xs text-slate-500"
                      }`}
                    >
                      {fmt.money(customer.dueAmount)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {customer.phone ? `${t("common.phone")}: ${customer.phone}` : null}
                  </p>
                  <p className="text-sm text-slate-600">
                    {customer.email ? `${t("common.email")}: ${customer.email}` : null}
                  </p>
                  {!customer.phone && !customer.email ? <p className="mt-1 text-sm text-slate-600">—</p> : null}
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    {t("storeCommerce.customers.points", { points: fmt.number(customer.loyaltyPoints) })}
                  </p>
                  <p className="print-hide mt-2 text-xs font-semibold text-slate-600">
                    {t("storeCommerce.customers.viewPurchases")}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="print-hide rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("storeCommerce.customers.addTitle")}
          </h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.name")}</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.phone")}</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("storeCommerce.customers.previousDue")}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={previousDue}
                onChange={(e) => setPreviousDue(e.target.value)}
                placeholder="0"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {t("storeCommerce.customers.previousDueHint")}
              </span>
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("storeCommerce.customers.addButton")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
