"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Company = {
  id: number;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  tenantDb: { status: string; dbName: string; lastError: string | null } | null;
};

type CompanyAdmin = { id: number; name: string; email: string };

const STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-700",
  active: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

const EDITABLE_STATUSES = ["active", "suspended", "archived"];

const FIELD_CLASS =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900";

function CompanyDetailPanel({
  company,
  onSaved,
}: {
  company: Company;
  onSaved: () => Promise<void>;
}) {
  const { t, tEnum, fmt } = useI18n();
  const [admin, setAdmin] = useState<CompanyAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState(company.name);
  const [slug, setSlug] = useState(company.slug);
  const [status, setStatus] = useState(company.status);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<{ company: Company; admin: CompanyAdmin | null }>(
          `/api/admin/companies/${company.id}`
        );
        if (cancelled) return;
        setAdmin(data.admin);
        setCompanyName(data.company.name);
        setSlug(data.company.slug);
        setStatus(data.company.status);
        setAdminName(data.admin?.name ?? "");
        setAdminEmail(data.admin?.email ?? "");
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/api/admin/companies/${company.id}`, "PATCH", {
        companyName,
        slug,
        status,
        adminName,
        adminEmail,
        adminPassword: adminPassword || undefined,
      });
      setAdminPassword("");
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">{t("common.loading")}</p>;
  }

  const statusOptions = EDITABLE_STATUSES.includes(status)
    ? EDITABLE_STATUSES
    : [status, ...EDITABLE_STATUSES];

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-950">{t("admin.companies.details")}</h3>

      <div className="mt-4 space-y-1.5 text-sm text-slate-600">
        <p>
          <span className="text-slate-400">{t("admin.companies.created")}: </span>
          <span className="font-medium text-slate-950">{fmt.dateTime(company.createdAt)}</span>
        </p>
        {company.tenantDb ? (
          <p>
            <span className="text-slate-400">{t("admin.companies.database")}: </span>
            <span className="font-medium text-slate-950">
              {company.tenantDb.dbName} · {tEnum(company.tenantDb.status)}
            </span>
            {company.tenantDb.lastError ? (
              <span className="block text-xs text-red-600"> {company.tenantDb.lastError}</span>
            ) : null}
          </p>
        ) : null}
        <p>
          <span className="text-slate-400">{t("admin.companies.adminAccount")}: </span>
          <span className="font-medium text-slate-950">
            {admin ? `${admin.name} (${admin.email})` : t("admin.companies.noAdmin")}
          </span>
        </p>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {saved ? <p className="mt-3 text-sm text-emerald-700">{t("admin.companies.saved")}</p> : null}

      <form onSubmit={handleSave} className="mt-5 space-y-4 border-t border-slate-100 pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("admin.companies.companyName")}</span>
            <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={FIELD_CLASS} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("admin.companies.slug")}</span>
            <input
              required
              pattern="[a-z0-9-]+"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-retail"
              className={FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("common.status")}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD_CLASS}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {tEnum(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("admin.companies.adminName")}</span>
            <input value={adminName} onChange={(e) => setAdminName(e.target.value)} className={FIELD_CLASS} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("admin.companies.adminEmail")}</span>
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={FIELD_CLASS} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">{t("admin.companies.adminPassword")}</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={adminPassword}
                placeholder={t("admin.companies.leavePasswordBlank")}
                onChange={(e) => setAdminPassword(e.target.value)}
                className={`${FIELD_CLASS} pr-16`}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
              >
                {showPassword ? t("admin.companies.hidePassword") : t("admin.companies.showPassword")}
              </button>
            </div>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? t("admin.companies.saving") : t("admin.companies.saveChanges")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AdminCompaniesPage() {
  const { t, tEnum } = useI18n();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  async function loadCompanies() {
    try {
      const data = await apiFetch<{ companies: Company[] }>("/api/admin/companies");
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
      await apiFetch("/api/admin/companies", "POST", {
        companyName,
        slug,
        adminName,
        adminEmail,
        adminPassword,
      });
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
                    <div>
                      <p className="font-semibold text-slate-950">{company.name}</p>
                      <p className="mt-0.5 text-sm text-slate-600">/{company.slug}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          STATUS_STYLES[company.status] ?? "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {tEnum(company.status)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === company.id ? null : company.id)}
                        aria-expanded={expandedId === company.id}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                      >
                        {t("admin.companies.viewDetails")}
                      </button>
                    </div>
                  </div>
                  {company.tenantDb ? (
                    <p className="mt-1 text-xs text-slate-500">
                      db: {company.tenantDb.dbName} · {tEnum(company.tenantDb.status)}
                      {company.tenantDb.lastError ? ` · ${company.tenantDb.lastError}` : ""}
                    </p>
                  ) : null}
                  {expandedId === company.id ? (
                    <CompanyDetailPanel company={company} onSaved={loadCompanies} />
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