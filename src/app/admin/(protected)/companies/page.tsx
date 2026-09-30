"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

type Company = {
  id: number;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  tenantDb: { status: string; dbName: string; lastError: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-700",
  active: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

export default function AdminCompaniesPage() {
  const { t, tEnum } = useI18n();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  async function loadCompanies() {
    try {
      const res = await fetch("/api/admin/companies");
      const data = await res.json();
      setCompanies(data.companies ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadCompanies();
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          slug,
          adminName,
          adminEmail,
          adminPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? t("admin.companies.createFailed"));

      setCompanyName("");
      setSlug("");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      await loadCompanies();

    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{t("nav.companies")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("admin.companies.description")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("admin.companies.allCompanies")}</h2>
          {loading ? (
            <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
          ) : companies.length === 0 ? (
            <p className="mt-6 text-sm text-slate-600">{t("admin.companies.noneYet")}</p>
          ) : (
            <div className="mt-6 space-y-3">
              {companies.map((company) => (
                <div key={company.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-950">{company.name}</p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        STATUS_STYLES[company.status] ?? "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {tEnum(company.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">/{company.slug}</p>
                  {company.tenantDb ? (
                    <p className="mt-1 text-xs text-slate-500">
                      db: {company.tenantDb.dbName} · {tEnum(company.tenantDb.status)}
                      {company.tenantDb.lastError ? ` · ${company.tenantDb.lastError}` : ""}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("admin.companies.onboardTitle")}</h2>
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("admin.companies.companyName")}</span>
              <input
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("admin.companies.slug")}</span>
              <input
                required
                pattern="[a-z0-9-]+"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme-retail"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("admin.companies.adminName")}</span>
              <input
                required
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("admin.companies.adminEmail")}</span>
              <input
                required
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("admin.companies.adminPassword")}</span>
              <input
                required
                type="password"
                minLength={8}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? t("admin.companies.provisioning") : t("admin.companies.create")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
