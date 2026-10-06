"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/tenant";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type NavLink = { href: string; label: TranslationKey };

const STORE_LINKS: NavLink[] = [
  { href: "/store", label: "nav.dashboard" },
  { href: "/store/pos", label: "nav.checkout" },
  { href: "/store/sales", label: "nav.sales" },
  { href: "/store/returns", label: "nav.returns" },
  { href: "/store/customers", label: "nav.customers" },
  { href: "/store/inventory", label: "nav.inventory" },
  { href: "/store/transfers", label: "nav.transfers" },
  { href: "/store/purchases", label: "nav.purchases" },
  { href: "/store/supplier-returns", label: "nav.supplierReturns" },
  { href: "/store/payments", label: "nav.payments" },
];

const MANAGER_ONLY_LINKS: NavLink[] = [
  { href: "/store/reports", label: "nav.reports" },
];

// Company workspace links both levels can use.
const COMPANY_LINKS: NavLink[] = [
  { href: "/company/products", label: "nav.products" },
  { href: "/company/categories", label: "nav.categories" },
  { href: "/company/suppliers", label: "nav.suppliers" },
  { href: "/company/payments", label: "nav.payments" },
  { href: "/company/banks", label: "nav.banks" },
  { href: "/company/bank-transfers", label: "nav.bankTransfers" },
  { href: "/company/withdrawals", label: "nav.withdrawals" },
  { href: "/company/expenditures", label: "nav.expenditures" },
];

// Company-wide management surfaces reserved for the company admin.
const COMPANY_ADMIN_ONLY_LINKS: NavLink[] = [
  { href: "/company/stores", label: "nav.stores" },
  { href: "/company/users", label: "nav.users" },
  { href: "/company/audit-log", label: "nav.auditLog" },
];

// "/store" and "/company" are section roots and must match exactly, otherwise
// "/store/pos" would light up Dashboard as well.
function isActive(pathname: string, href: string): boolean {
  if (href === "/store" || href === "/company") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const { t } = useI18n();
  // Users, stores, reports and audit log are company-admin surfaces. A store
  // manager gets the operational links plus the shared company workspace, but
  // not the management pages.
  const links =
    role === "company_admin"
      ? [...STORE_LINKS, ...MANAGER_ONLY_LINKS, ...COMPANY_LINKS, ...COMPANY_ADMIN_ONLY_LINKS]
      : role === "store_manager"
        ? [...STORE_LINKS, ...COMPANY_LINKS]
        : [...STORE_LINKS];

  return (
    <nav className="flex w-full flex-wrap items-center gap-1 rounded-2xl bg-slate-100/80 p-1">
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3.5 py-1.5 text-sm transition ${
              active
                ? "bg-slate-950 font-semibold text-white shadow-sm"
                : "text-slate-600 hover:bg-white hover:text-slate-950"
            }`}
          >
            {t(link.label)}
          </Link>
        );
      })}
    </nav>
  );
}
