"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/services/api";

type Product = {
  id: number;
  sku: string;
  name: string;
  category: { id: number; name: string } | null;
  purchasePrice: string;
  salePrice: string;
  taxRate: string;
  totalStock: number;
};

type Category = { id: number; name: string };

export default function CompanyProductsPage() {
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
    try {
      const [productsData, categoriesData] = await Promise.all([
        apiFetch<{ products: Product[] }>("/api/company/products"),
        apiFetch<{ categories: Category[] }>("/api/company/categories"),
      ]);
      setProducts(productsData.products);
      setCategories(categoriesData.categories);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
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
        purchasePrice: Number(purchasePrice),
        salePrice: Number(salePrice),
        taxRate: Number(taxRate),
      });
      setSku("");
      setName("");
      selectCategory(null);
      setPurchasePrice("");
      setSalePrice("");
      setTaxRate("0");
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Products</h1>

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
                    <th className="pb-2">Sale price</th>
                    <th className="pb-2">Total stock</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="border-t border-slate-100">
                      <td className="py-2 text-slate-600">{product.sku}</td>
                      <td className="py-2 font-medium text-slate-950">{product.name}</td>
                      <td className="py-2 text-slate-600">{product.category?.name ?? "—"}</td>
                      <td className="py-2 text-slate-600">{product.salePrice}</td>
                      <td className="py-2 text-slate-600">{product.totalStock}</td>
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
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Purchase price</span>
              <input
                required
                type="number"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Sale price</span>
              <input
                required
                type="number"
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
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
