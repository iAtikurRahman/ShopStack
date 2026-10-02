"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type Entry = {
  id: number;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  createdAt: string;
};

type Translate = ReturnType<typeof useI18n>["t"];

/** Raw audit codes come from the API; this maps them to a readable label. */
const ACTION_KEYS: Record<string, TranslationKey> = {
  "product.created": "company.auditLog.actions.productCreated",
  "product.updated": "company.auditLog.actions.productUpdated",
  "product.price_updated": "company.auditLog.actions.productPriceUpdated",
  "product.pricing_bulk_updated": "company.auditLog.actions.productPricingBulkUpdated",
  "product.removed_from_warehouse": "company.auditLog.actions.productRemovedFromWarehouse",
  "sale.created": "company.auditLog.actions.saleCreated",
  "return.created": "company.auditLog.actions.returnCreated",
  "return.refund_edited": "company.auditLog.actions.returnRefundEdited",
  "warehouse.created": "company.auditLog.actions.warehouseCreated",
  "user.created": "company.auditLog.actions.userCreated",
  "user.updated": "company.auditLog.actions.userUpdated",
  "user.deactivated": "company.auditLog.actions.userDeactivated",
  "user.permissions_updated": "company.auditLog.actions.userPermissionsUpdated",
  "user.password_reset": "company.auditLog.actions.userPasswordReset",
  "store.created": "company.auditLog.actions.storeCreated",
  "store.updated": "company.auditLog.actions.storeUpdated",
  "category.created": "company.auditLog.actions.categoryCreated",
  "supplier.created": "company.auditLog.actions.supplierCreated",
  "payment.created": "company.auditLog.actions.paymentCreated",
  "payment.updated": "company.auditLog.actions.paymentUpdated",
  "payment.voided": "company.auditLog.actions.paymentVoided",
  "bank.created": "company.auditLog.actions.bankCreated",
  "bank.updated": "company.auditLog.actions.bankUpdated",
  "bank.deleted": "company.auditLog.actions.bankDeleted",
};

const ENTITY_KEYS: Record<string, TranslationKey> = {
  Product: "company.auditLog.entities.product",
  Sale: "company.auditLog.entities.sale",
  Return: "company.auditLog.entities.return",
  Warehouse: "company.auditLog.entities.warehouse",
  User: "company.auditLog.entities.user",
  Store: "company.auditLog.entities.store",
  Category: "company.auditLog.entities.category",
  Supplier: "company.auditLog.entities.supplier",
  Payment: "company.auditLog.entities.payment",
  BankInfo: "company.auditLog.entities.bank",
};

function actionLabel(t: Translate, action: string): string {
  const key = ACTION_KEYS[action];
  return key ? t(key) : action;
}

function entityLabel(t: Translate, entityType: string): string {
  const key = ENTITY_KEYS[entityType];
  return key ? t(key) : entityType;
}

export default function CompanyAuditLogPage() {
  const { t, fmt } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        (entry.userEmail ?? "system").toLowerCase().includes(q) ||
        entry.action.toLowerCase().includes(q) ||
        entry.entityType.toLowerCase().includes(q) ||
        (entry.entityId !== null && String(entry.entityId).includes(q)) ||
        entry.createdAt.slice(0, 10).includes(q)
    );
  }, [entries, search]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<{ entries: Entry[] }>("/api/company/audit-log");
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
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("company.auditLog.searchPlaceholder")}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
        />
        {loading ? (
          <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
        ) : filteredEntries.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">
            {search.trim()
              ? t("company.auditLog.noMatch", { search: search.trim() })
              : t("company.auditLog.noneYet")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2">{t("company.auditLog.when")}</th>
                  <th className="pb-2">{t("company.auditLog.actor")}</th>
                  <th className="pb-2">{t("company.auditLog.action")}</th>
                  <th className="pb-2">{t("company.auditLog.entity")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100">
                    <td className="py-2 text-slate-500">{fmt.dateTime(entry.createdAt)}</td>
                    <td className="py-2 text-slate-600">
                      {entry.userEmail ?? t("company.auditLog.system")}
                    </td>
                    <td className="py-2 font-medium text-slate-950">{actionLabel(t, entry.action)}</td>
                    <td className="py-2 text-slate-600">
                      {entityLabel(t, entry.entityType)}
                      {entry.entityId ? ` #${fmt.number(entry.entityId)}` : ""}
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
