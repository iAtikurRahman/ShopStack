"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type StockByStore = { warehouseId: number; warehouseName: string; storeId: number; storeName: string; quantity: number };

type Product = {
  id: number;
  sku: string;
  name: string;
  category: { id: number; name: string } | null;
  unitValue: string | null;
  unit: string | null;
  purchasePrice: string;
  salePrice: string;
  taxRate: string;
  totalStock: number;
  stockByStore: StockByStore[];
};

type Category = { id: number; name: string };

const UNIT_OPTIONS = ["piece", "kg", "g", "liter", "ml", "box", "pack", "dozen"];

const PRICE_INPUT_CLASS =
  "w-24 rounded-lg border border-slate-200 px-2 py-1 text-right outline-none focus:border-slate-900";

export default function CompanyProductsPage() {
  const { t, fmt } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [unitValue, setUnitValue] = useState("");
  const [unit, setUnit] = useState("piece");

  const [markupPercent, setMarkupPercent] = useState("25");
  const [bulkTaxRate, setBulkTaxRate] = useState("");
  const [includePriced, setIncludePriced] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [categoryQuery, setCategoryQuery] = useState("");
  const [search, setSearch] = useState("");
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const categoryFieldRef = useRef<HTMLDivElement>(null);

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(categoryQuery.trim().toLowerCase())
  );

  const filteredProducts = products.filter((product) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      product.sku.toLowerCase().includes(q) ||
      product.name.toLowerCase().includes(q) ||
      (product.category?.name ?? "").toLowerCase().includes(q) ||
      (product.unit ?? "").toLowerCase().includes(q) ||
      product.stockByStore.some((s) => `${s.storeName} ${s.warehouseName}`.toLowerCase().includes(q))
    );
  });

  function selectCategory(category: Category | null) {
    setCategoryId(category ? String(category.id) : "");
    setCategoryQuery(category ? category.name : "");
    setIsCategoryOpen(false);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (categoryFieldRef.current && !categoryFieldRef.current.contains(event.target as Node)) {
        setIsCategoryOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadData() {
    const [productsResult, categoriesResult] = await Promise.allSettled([
      apiFetch<{ products: Product[] }>("/api/company/products"),
      apiFetch<{ categories: Category[] }>("/api/company/categories"),
    ]);

    if (productsResult.status === "fulfilled") setProducts(productsResult.value.products);
    if (categoriesResult.status === "fulfilled") setCategories(categoriesResult.value.categories);

    const failures = [productsResult, categoriesResult]
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => (r.reason as Error).message);
    setError(failures.length > 0 ? failures.join("; ") : null);
    setLoading(false);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadData();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/company/products", "POST", {
        sku,
        name,
        categoryId: categoryId || null,
        purchasePrice: purchasePrice === "" ? 0 : Number(purchasePrice),
        salePrice: salePrice === "" ? 0 : Number(salePrice),
        taxRate: Number(taxRate),
        unitValue: unitValue === "" ? null : Number(unitValue),
        unit,
      });
      setSku("");
      setName("");
      selectCategory(null);
      setPurchasePrice("");
      setSalePrice("");
      setTaxRate("0");
      setUnitValue("");
      setUnit("piece");
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function savePrice(productId: number, field: "purchasePrice" | "salePrice", value: string) {
    setError(null);
    const product = products.find((p) => p.id === productId);
    if (!product || value === product[field]) return;

    // Optimistic: keep the typing responsive, the reload below is the real check.
    setProducts((current) => current.map((p) => (p.id === productId ? { ...p, [field]: value } : p)));
    try {
      await apiFetch(`/api/company/products/${productId}`, "PATCH", { [field]: Number(value) });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
      await loadData();
    }
  }

  async function handleBulkPricing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBulkApplying(true);
    try {
      const result = await apiFetch<{
        updated: number;
        skipped: { sku: string; name: string; reason: string }[];
      }>("/api/company/products/pricing", "PUT", {
        markupPercent: Number(markupPercent),
        taxRate: bulkTaxRate === "" ? null : Number(bulkTaxRate),
        includePriced,
      });
      const skippedNote =
        result.skipped.length > 0
          ? ` ${t("company.products.skippedNote", { count: fmt.number(result.skipped.length) })}`
          : "";
      const pricedNote = t(
        result.updated === 1 ? "company.products.pricedOne" : "company.products.pricedMany",
        { count: fmt.number(result.updated) }
      );
      setNotice(`${pricedNote}${skippedNote}`);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkApplying(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.products")}</h1>
      <p className="text-sm text-slate-600">{t("company.products.priceNote")}</p>
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.products.allTitle")}</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("company.products.searchPlaceholder")}
            className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
          />
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : filteredProducts.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">
              {search.trim()
                ? t("company.products.noMatch", { search: search.trim() })
                : t("company.products.noneYet")}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2">{t("company.products.sku")}</th>
                    <th className="pb-2">{t("common.name")}</th>
                    <th className="pb-2">{t("nav.categories")}</th>
                    <th className="pb-2">{t("company.products.unit")}</th>
                    <th className="pb-2">{t("common.cost")}</th>
                    <th className="pb-2">{t("company.products.salePrice")}</th>
                    <th className="pb-2">{t("company.products.totalStock")}</th>
                    <th className="pb-2">{t("company.products.byStore")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id} className="border-t border-slate-100">
                      <td className="py-2 text-slate-600">{product.sku}</td>
                      <td className="py-2 font-medium text-slate-950">{product.name}</td>
                      <td className="py-2 text-slate-600">{product.category?.name ?? "—"}</td>
                      <td className="py-2 text-slate-600">
                        {product.unitValue
                          ? `${fmt.quantity(product.unitValue)} ${product.unit ?? ""}`.trim()
                          : product.unit ?? "—"}
                      </td>
                      <td className="py-2">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          defaultValue={product.purchasePrice}
                          onBlur={(e) => savePrice(product.id, "purchasePrice", e.target.value)}
                          className={PRICE_INPUT_CLASS}
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          defaultValue={product.salePrice}
                          onBlur={(e) => savePrice(product.id, "salePrice", e.target.value)}
                          className={PRICE_INPUT_CLASS}
                        />
                      </td>
                      <td className="py-2 text-slate-600">{fmt.quantity(product.totalStock)}</td>
                      <td className="py-2 text-xs text-slate-500">
                        {product.stockByStore.length === 0
                          ? "—"
                          : product.stockByStore
                              .map((s) => `${s.storeName} (${s.warehouseName}): ${fmt.quantity(s.quantity)}`)
                              .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.products.bulkTitle")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("company.products.bulkHelper")}</p>
          <form onSubmit={handleBulkPricing} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.products.markupOnCost")}
              </span>
              <input
                required
                type="number"
                step="0.01"
                min={0}
                value={markupPercent}
                onChange={(e) => setMarkupPercent(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("company.products.setTaxRate")}
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={bulkTaxRate}
                onChange={(e) => setBulkTaxRate(e.target.value)}
                placeholder={t("company.products.keepCurrent")}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={includePriced}
                onChange={(e) => setIncludePriced(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t("company.products.alsoReprice")}
            </label>
            <button
              type="submit"
              disabled={bulkApplying}
              className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {bulkApplying ? t("company.products.applying") : t("company.products.applyToCatalog")}
            </button>
          </form>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("company.products.addTitle")}</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.products.sku")}</span>
              <input
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("common.name")}</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{t("common.cost")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("company.products.salePrice")}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
              </label>
            </div>
            <div className="block" ref={categoryFieldRef}>
              <span className="text-sm font-medium text-slate-700">{t("nav.categories")}</span>
              <div className="relative mt-2">
                <input
                  value={categoryQuery}
                  onChange={(e) => {
                    setCategoryQuery(e.target.value);
                    setCategoryId("");
                    setIsCategoryOpen(true);
                  }}
                  onFocus={() => setIsCategoryOpen(true)}
                  placeholder={t("company.products.searchCategory")}
                  autoComplete="off"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
                {isCategoryOpen ? (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                    <li>
                      <button
                        type="button"
                        onClick={() => selectCategory(null)}
                        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100"
                      >
                        {t("common.none")}
                      </button>
                    </li>
                    {filteredCategories.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-slate-400">
                        {t("company.products.noMatchingCategories")}
                      </li>
                    ) : (
                      filteredCategories.map((category) => (
                        <li key={category.id}>
                          <button
                            type="button"
                            onClick={() => selectCategory(category)}
                            className={`block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-100 ${
                              String(category.id) === categoryId
                                ? "bg-slate-100 font-medium text-slate-950"
                                : "text-slate-700"
                            }`}
                          >
                            {category.name}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("company.products.unitValue")}
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitValue}
                  onChange={(e) => setUnitValue(e.target.value)}
                  placeholder={t("company.products.unitValuePlaceholder")}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{t("company.products.unit")}</span>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("company.products.taxRate")}</span>
              <input
                type="number"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {t("company.products.create")}
            </button>
          </form>
        </div>
        </div>
      </div>
    </main>
  );
}
