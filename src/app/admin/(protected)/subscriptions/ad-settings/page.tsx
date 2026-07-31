"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/services/api";

type AdSettings = {
  adsenseClientId: string | null;
  adUnitId: string | null;
  placement: "modal" | "fullscreen";
  countdownSeconds: number;
  isEnabled: boolean;
  frequencyMinutes: number;
};

export default function AdminAdSettingsPage() {
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch<{ adSettings: AdSettings }>("/api/admin/subscriptions/ad-settings");
        setSettings(data.adSettings);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const data = await apiFetch<{ adSettings: AdSettings }>("/api/admin/subscriptions/ad-settings", "PUT", settings);
      setSettings(data.adSettings);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) return <main className="p-8 text-sm text-slate-600">Loading…</main>;

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-950">Advertisement settings</h1>
        <Link href="/admin/subscriptions" className="text-sm text-slate-600 hover:underline">
          ← Back to subscriptions
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={settings.isEnabled}
            onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
          />
          Show ads to free-tier companies
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Google AdSense Client ID</span>
          <input
            value={settings.adsenseClientId ?? ""}
            onChange={(e) => setSettings({ ...settings, adsenseClientId: e.target.value })}
            placeholder="ca-pub-xxxxxxxxxxxxxxxx"
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Ad Unit ID</span>
          <input
            value={settings.adUnitId ?? ""}
            onChange={(e) => setSettings({ ...settings, adUnitId: e.target.value })}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Placement</span>
          <select
            value={settings.placement}
            onChange={(e) => setSettings({ ...settings, placement: e.target.value as "modal" | "fullscreen" })}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
          >
            <option value="modal">Modal</option>
            <option value="fullscreen">Fullscreen</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Countdown before Close is enabled (seconds)</span>
          <input
            type="number"
            min={1}
            value={settings.countdownSeconds}
            onChange={(e) => setSettings({ ...settings, countdownSeconds: Number(e.target.value) })}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Minimum minutes between ad shows</span>
          <input
            type="number"
            min={1}
            value={settings.frequencyMinutes}
            onChange={(e) => setSettings({ ...settings, frequencyMinutes: Number(e.target.value) })}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {saved ? <p className="text-sm text-emerald-600">Saved.</p> : null}
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </main>
  );
}
