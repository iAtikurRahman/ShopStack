"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Store = {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  _count: { warehouses: number; users: number };
};

export default function CompanyStoresPage() {
  const { t } = useI18n();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [addManager, setAddManager] = useState(false);
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [search, setSearch] = useState("");

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stores;
    const digits = q.replace(/\D/g, "");
    return stores.filter(
      (store) =>
        store.name.toLowerCase().includes(q) ||
        (store.address ?? "").toLowerCase().includes(q) ||
        (store.phone ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && (store.phone ?? "").replace(/\D/g, "").includes(digits)) ||
        (store.isActive ? "active" : "inactive").includes(q)
    );
  }, [stores, search]);

  async function loadStores() {
    try {
      const data = await apiFetch<{ stores: Store[] }>("/api/company/stores");
      setStores(data.stores);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadStores();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/company/stores", "POST", {
        name,
        address: address || null,
        phone: phone || null,
        storeManager: addManager
          ? { name: managerName, email: managerEmail, password: managerPassword }
          : undefined,
      });
      setName("");
      setAddress("");
      setPhone("");
      setAddManager(false);
      setManagerName("");
      setManagerEmail("");
      setManagerPassword("");
      await loadStores();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.stores")}</h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.stores.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.stores.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredStores.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.stores.noMatch", { search: search.trim() })
                : t("company.stores.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredStores.map((store) => (
                <Link
                  key={store.id}
                  href={`/company/stores/${store.id}/warehouses`}
                  className="block rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-950">{store.name}</p>
                    {!store.isActive ? (
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                        {t("company.stores.inactivePill")}
                      </span>
                    ) : null}
                  </div>
                  {store.address ? <p className="mt-1 text-sm text-slate-600">{store.address}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {t("company.stores.warehouseCount", { count: store._count.warehouses })} ·{" "}
                    {t("company.stores.userCount", { count: store._count.users })}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.stores.addTitle")}</h2>
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
              <span className="text-sm font-medium text-slate-700">{t("common.address")}</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
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
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={addManager}
                onChange={(e) => setAddManager(e.target.checked)}
                className="rounded border-slate-300"
              />
              {t("company.stores.alsoCreateManager")}
            </label>

            {addManager ? (
              <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("company.stores.managerName")}
                  </span>
                  <input
                    required={addManager}
                    value={managerName}
                    onChange={(e) => setManagerName(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("company.stores.managerEmail")}
                  </span>
                  <input
                    required={addManager}
                    type="email"
                    value={managerEmail}
                    onChange={(e) => setManagerEmail(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("company.stores.managerPassword")}
                  </span>
                  <input
                    required={addManager}
                    type="password"
                    minLength={8}
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:border-slate-900"
                  />
                </label>
              </div>
            ) : null}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("company.stores.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
