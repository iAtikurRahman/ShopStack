import Link from "next/link";
import type { Role } from "@/generated/tenant";
import { LogoutButton } from "@/components/LogoutButton";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { WorkspaceNav } from "@/components/WorkspaceNav";

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

type WorkspaceHeaderProps = {
  role: Role;
  title: string;
  name: string;
  homeHref: string;
};

export function WorkspaceHeader({ role, title, name, homeHref }: WorkspaceHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href={homeHref} className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-xs font-semibold tracking-wide text-white">
              SS
            </span>
            <span className="leading-tight">
              <span className="block text-[11px] uppercase tracking-[0.28em] text-slate-400">ShopStack</span>
              <span className="block text-lg font-semibold text-slate-950">{title}</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {initialsOf(name)}
              </span>
              <span className="text-sm text-slate-600">{name}</span>
            </span>
            <LogoutButton redirectTo="/login" />
          </div>
        </div>

        <WorkspaceNav role={role} />
      </div>
    </header>
  );
}
