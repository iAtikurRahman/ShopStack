"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Category = {
  id: number;
  name: string;
  parent: { id: number; name: string } | null;
};

export default function CompanyCategoriesPage() {
  const { t } = useI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [search, setSearch] = useState("");

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (category) =>
        category.name.toLowerCase().includes(q) || (category.parent?.name ?? "").toLowerCase().includes(q)
    );
  }, [categories, search]);

  async function loadCategories() {
    try {
      const data = await apiFetch<{ categories: Category[] }>("/api/company/categories");
      setCategories(data.categories);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadCategories();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/company/categories", "POST", { name, parentId: parentId || null });
      setName("");
      setParentId("");
      await loadCategories();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.categories")}</h1>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.categories.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.categories.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredCategories.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.categories.noMatch", { search: search.trim() })
                : t("company.categories.noneYet")}
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {filteredCategories.map((category) => (
                <div key={category.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="font-semibold text-slate-950">{category.name}</p>
                  {category.parent ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {t("company.categories.under", { parent: category.parent.name })}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.categories.addTitle")}</h2>
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
                {t("company.categories.parentOptional")}
              </span>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              >
                <option value="">{t("common.none")}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("company.categories.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
