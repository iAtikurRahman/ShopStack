"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/tenant";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type NavLink = { href: string; label: TranslationKey };

// The bar starts Dashboard, then Categories, then Products: the catalog is the
// common path for a shop, so it sits straight after the landing page.
const DASHBOARD_LINK: NavLink = { href: "/store", label: "nav.dashboard" };

const CATALOG_LINKS: NavLink[] = [
  { href: "/company/categories", label: "nav.categories" },
  { href: "/company/products", label: "nav.products" },
];

const CUSTOMERS_LINK: NavLink = { href: "/store/customers", label: "nav.customers" };
const SUPPLIERS_LINK: NavLink = { href: "/company/suppliers", label: "nav.suppliers" };

const STORE_LINKS: NavLink[] = [
  { href: "/store/pos", label: "nav.checkout" },
  { href: "/store/sales", label: "nav.sales" },
  { href: "/store/returns", label: "nav.returns" },
  { href: "/store/inventory", label: "nav.inventory" },
  { href: "/store/transfers", label: "nav.transfers" },
  { href: "/store/purchases", label: "nav.purchases" },
  { href: "/store/supplier-returns", label: "nav.supplierReturns" },
  { href: "/store/payments", label: "nav.payments" },
];

const REPORTS_LINK: NavLink = { href: "/store/reports", label: "nav.reports" };

// Company workspace links both levels can use. Payments stays in the
// operational group (/store/payments) so it is not duplicated in the bar.
const COMPANY_LINKS: NavLink[] = [
  { href: "/company/banks", label: "nav.banks" },
  { href: "/company/bank-transfers", label: "nav.bankTransfers" },
  { href: "/company/withdrawals", label: "nav.withdrawals" },
  { href: "/company/expenditures", label: "nav.expenditures" },
];

// Company-wide management surfaces reserved for the company admin.
const COMPANY_ADMIN_ONLY_LINKS: NavLink[] = [
  { href: "/company/stores", label: "nav.stores" },
  { href: "/company/users", label: "nav.users" },
  REPORTS_LINK,
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
      ? [
          DASHBOARD_LINK,
          ...CATALOG_LINKS,
          CUSTOMERS_LINK,
          SUPPLIERS_LINK,
          ...STORE_LINKS,
          ...COMPANY_LINKS,
          ...COMPANY_ADMIN_ONLY_LINKS,
        ]
      : role === "store_manager"
        ? [
            DASHBOARD_LINK,
            ...CATALOG_LINKS,
            CUSTOMERS_LINK,
            SUPPLIERS_LINK,
            ...STORE_LINKS,
            ...COMPANY_LINKS,
          ]
        : [DASHBOARD_LINK, CUSTOMERS_LINK, ...STORE_LINKS];

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
