import Link from "next/link";
import type { Role } from "@/generated/tenant";
import { LogoutButton } from "@/components/LogoutButton";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { WorkspaceNav } from "@/components/WorkspaceNav";

type WorkspaceHeaderProps = {
  role: Role;
  title: string;
  name: string;
  homeHref: string;
};

export function WorkspaceHeader({ role, title, name, homeHref }: WorkspaceHeaderProps) {
  return (
    // `print-hide`: the navigation is screen furniture. It has no business on
    // a printed report, which carries its own letterhead instead.
    <header className="print-hide border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href={homeHref} className="flex items-center gap-3">
            <span className="leading-tight">
              <span className="block text-[11px] uppercase tracking-[0.28em] text-slate-400">Nexora POS</span>
              <span className="block text-lg font-semibold text-slate-950">{title}</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-3 pr-3">
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
