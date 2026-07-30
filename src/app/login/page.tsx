"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/services/api";

export default function LoginPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSlugBlur() {
    if (!slug) {
      setCompanyName(null);
      return;
    }
    try {
      const data = await apiFetch<{ companyName: string }>("/api/auth/resolve-company", "POST", { slug });
      setCompanyName(data.companyName);
      setError(null);
    } catch {
      setCompanyName(null);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await apiFetch<{ user: { role: string } }>("/api/auth/login", "POST", {
        slug,
        email,
        password,
      });
      router.push(data.user.role === "company_admin" ? "/company" : "/store");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
        <div className="w-full rounded-4xl border border-slate-200 bg-white p-10 shadow-xl">
          <h1 className="text-3xl font-semibold">Sign in to ShopStack</h1>
          <p className="mt-3 text-sm text-slate-600">
            {companyName ? `Welcome to ${companyName}.` : "Enter your company workspace to continue."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Company slug</span>
              <input
                type="text"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                onBlur={handleSlugBlur}
                required
                placeholder="acme-retail"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-slate-900"
              />
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
