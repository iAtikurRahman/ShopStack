"use client";

import { useEffect, useMemo, useState } from "react";
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
      <h1 className="text-2xl font-semibold text-slate-950">Audit log</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by actor, action, entity or date…"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
        />
        {loading ? (
          <p className="mt-6 text-sm text-slate-600">Loading…</p>
        ) : filteredEntries.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">
            {search.trim() ? `No entries match "${search.trim()}".` : "No activity recorded yet."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
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
                {filteredEntries.map((entry) => (
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
