"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/services/api";

export function LogoutButton({ redirectTo, className }: { redirectTo: string; className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await apiFetch("/api/auth/logout", "POST");
    } finally {
      router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className={className ?? "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-50"}
    >
      {loading ? "Signing out…" : "Log out"}
    </button>
  );
}
