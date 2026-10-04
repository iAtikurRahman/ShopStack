"use client";

import { useEffect } from "react";

/**
 * The print button, and the reason the print dialog opens by itself.
 *
 * Printing needs a user gesture on some browsers, so the dialog is offered
 * once the figures are on the page rather than the moment the tab opens - and
 * the button stays for the second attempt if the browser blocked the first.
 */
export function PrintButton({ label }: { label: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="no-print mb-4 flex justify-end">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
      >
        {label}
      </button>
    </div>
  );
}