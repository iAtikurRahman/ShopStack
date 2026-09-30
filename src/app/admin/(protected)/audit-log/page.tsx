"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type Entry = {
  id: number;
  action: string;
  targetType: string;
  targetId: number | null;
  createdAt: string;
};

type Translate = ReturnType<typeof useI18n>["t"];

/** Raw central audit codes come from the API; this maps them to a readable label. */
const ACTION_KEYS: Record<string, TranslationKey> = {
  "company.provisioned": "admin.auditLog.actions.companyProvisioned",
  "project_admin.setup": "admin.auditLog.actions.projectAdminSetup",
};

const ENTITY_KEYS: Record<string, TranslationKey> = {
  Company: "admin.auditLog.entities.company",
  ProjectAdmin: "admin.auditLog.entities.projectAdmin",
};

function actionLabel(t: Translate, action: string): string {
  const key = ACTION_KEYS[action];
  return key ? t(key) : action;
}

function entityLabel(t: Translate, targetType: string): string {
  const key = ENTITY_KEYS[targetType];
  return key ? t(key) : targetType;
}

export default function AdminAuditLogPage() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<{ entries: Entry[] }>("/api/admin/audit-log");
        setEntries(data.entries);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.auditLog")}</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-600">{t("common.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-600">{t("admin.auditLog.noneYet")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2">{t("admin.auditLog.when")}</th>
                  <th className="pb-2">{t("admin.auditLog.action")}</th>
                  <th className="pb-2">{t("admin.auditLog.target")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100">
                    <td className="py-2 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="py-2 font-medium text-slate-950">{actionLabel(t, entry.action)}</td>
                    <td className="py-2 text-slate-600">
                      {entityLabel(t, entry.targetType)}
                      {entry.targetId ? ` #${entry.targetId}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
