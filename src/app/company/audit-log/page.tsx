"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Entry = {
  id: number;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  createdAt: string;
};

export default function CompanyAuditLogPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <h1 className="text-2xl font-semibold text-slate-950">Audit log</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-600">No activity recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2">When</th>
                  <th className="pb-2">Actor</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2">Entity</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100">
                    <td className="py-2 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="py-2 text-slate-600">{entry.userEmail ?? "system"}</td>
                    <td className="py-2 font-medium text-slate-950">{entry.action}</td>
                    <td className="py-2 text-slate-600">
                      {entry.entityType}
                      {entry.entityId ? ` #${entry.entityId}` : ""}
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
