"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Supplier = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  dueAmount: number;
};

export default function CompanySuppliersPage() {
  const { t, fmt } = useI18n();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  // What we already owed this supplier when we started tracking them. Defaults
  // to 0; the field stays optional, so clearing it also records no due.
  const [previousDue, setPreviousDue] = useState("0");
  const [search, setSearch] = useState("");

  async function loadSuppliers() {
    try {
      const data = await apiFetch<{ suppliers: Supplier[] }>("/api/company/suppliers");
      setSuppliers(data.suppliers);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadSuppliers();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/company/suppliers", "POST", {
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        previousDue: previousDue === "" ? undefined : Number(previousDue),
      });
      setName("");
      setPhone("");
      setEmail("");
      setAddress("");
      setPreviousDue("0");
      await loadSuppliers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => {
      const digits = q.replace(/\D/g, "");
      return (
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q) ||
        (s.address ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && (s.phone ?? "").replace(/\D/g, "").includes(digits))
      );
    });
  }, [suppliers, search]);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.suppliers")}</h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.suppliers.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.suppliers.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredSuppliers.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.suppliers.noMatch", { search: search.trim() })
                : t("company.suppliers.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredSuppliers.map((supplier) => (
                <Link
                  key={supplier.id}
                  href={`/company/suppliers/${supplier.id}`}
                  className="block rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{supplier.name}</p>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        supplier.dueAmount > 0
                          ? "text-sm text-amber-700"
                          : supplier.dueAmount < 0
                            ? "text-sm text-emerald-700"
                            : "text-xs text-slate-500"
                      }`}
                    >
                      {fmt.money(supplier.dueAmount)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {[supplier.phone, supplier.email].filter(Boolean).join(" · ") ||
                      t("company.suppliers.noContact")}
                  </p>
                  {supplier.address ? <p className="mt-1 text-xs text-slate-500">{supplier.address}</p> : null}
                  <p className="mt-2 text-xs font-semibold text-slate-600">
                    {t("company.suppliers.viewPurchases")}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.suppliers.addTitle")}</h2>
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
              <span className="text-sm font-medium text-slate-700">
                {t("company.suppliers.phoneOptional")}
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.suppliers.emailOptional")}
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.suppliers.addressOptional")}
              </span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.suppliers.previousDue")}
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
                {t("company.suppliers.previousDueHint")}
              </span>
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("company.suppliers.addButton")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
