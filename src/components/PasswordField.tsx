"use client";

import { useState } from "react";
import { generatePassword } from "@/lib/generate-password";

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
};

const ACTION_CLASS =
  "rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-white";

/**
 * Password input with Show/Hide, Generate and Copy controls. Used wherever an
 * admin types a password on someone's behalf (create user, reset password).
 */
export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "new-password",
  hint,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <input
          required
          type={visible ? "text" : "password"}
          minLength={8}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:border-slate-900"
        />
      </label>
      {hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setVisible((current) => !current)} className={ACTION_CLASS}>
          {visible ? "Hide" : "Show"}
        </button>
        <button type="button" onClick={() => onChange(generatePassword())} className={ACTION_CLASS}>
          Generate
        </button>
        <button type="button" onClick={handleCopy} className={ACTION_CLASS}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
