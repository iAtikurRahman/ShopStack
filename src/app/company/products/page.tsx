"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/services/api";

type StockByStore = { warehouseId: number; warehouseName: string; storeId: number; storeName: string; quantity: number };

type Product = {
  id: number;
  sku: string;
  name: string;
  category: { id: number; name: string } | null;
  unitValue: string | null;
  unit: string | null;
  totalStock: number;
  stockByStore: StockByStore[];
};

type Category = { id: number; name: string };

const UNIT_OPTIONS = ["piece", "kg", "g", "liter", "ml", "box", "pack", "dozen"];

export default function CompanyProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [unitValue, setUnitValue] = useState("");
  const [unit, setUnit] = useState("piece");

  const [categoryQuery, setCategoryQuery] = useState("");
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const categoryFieldRef = useRef<HTMLDivElement>(null);

  const filteredCategories = categories.filter((category) =>
    category.name.toLowerCase().includes(categoryQuery.trim().toLowerCase())
  );

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
        taxRate: Number(taxRate),
        unitValue: unitValue === "" ? null : Number(unitValue),
        unit,
      });
      setSku("");
      setName("");
      selectCategory(null);
      setTaxRate("0");
      setUnitValue("");
      setUnit("piece");
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Products</h1>
      <p className="text-sm text-slate-600">
        Price is set per-store from Warehouse Products; purchases (with cost and supplier) are recorded from Purchases.
      </p>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">All products</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">Loading…</p>
          ) : products.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">No products yet.</p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-2">SKU</th>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Category</th>
                    <th className="pb-2">Unit</th>
                    <th className="pb-2">Total stock</th>
                    <th className="pb-2">By store</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="border-t border-slate-100">
                      <td className="py-2 text-slate-600">{product.sku}</td>
                      <td className="py-2 font-medium text-slate-950">{product.name}</td>
                      <td className="py-2 text-slate-600">{product.category?.name ?? "—"}</td>
                      <td className="py-2 text-slate-600">
                        {product.unitValue ? `${product.unitValue} ${product.unit ?? ""}`.trim() : product.unit ?? "—"}
                      </td>
                      <td className="py-2 text-slate-600">{product.totalStock}</td>
                      <td className="py-2 text-xs text-slate-500">
                        {product.stockByStore.length === 0
                          ? "—"
                          : product.stockByStore
                              .map((s) => `${s.storeName} (${s.warehouseName}): ${s.quantity}`)
                              .join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Add a product</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">SKU</span>
              <input
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <div className="block" ref={categoryFieldRef}>
              <span className="text-sm font-medium text-slate-700">Category</span>
              <div className="relative mt-2">
                <input
                  value={categoryQuery}
                  onChange={(e) => {
                    setCategoryQuery(e.target.value);
                    setCategoryId("");
                    setIsCategoryOpen(true);
                  }}
                  onFocus={() => setIsCategoryOpen(true)}
                  placeholder="Search category…"
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
                        None
                      </button>
                    </li>
                    {filteredCategories.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-slate-400">No matching categories</li>
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
                <span className="text-sm font-medium text-slate-700">Unit value</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitValue}
                  onChange={(e) => setUnitValue(e.target.value)}
                  placeholder="e.g. 250"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Unit</span>
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
              <span className="text-sm font-medium text-slate-700">Tax rate (%)</span>
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
              Create product
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
