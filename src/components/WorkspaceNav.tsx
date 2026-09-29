"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/tenant";

type NavLink = { href: string; label: string };

const STORE_LINKS: NavLink[] = [
  { href: "/store", label: "Dashboard" },
  { href: "/store/pos", label: "Checkout" },
  { href: "/store/sales", label: "Sales" },
  { href: "/store/returns", label: "Returns" },
  { href: "/store/customers", label: "Customers" },
  { href: "/store/inventory", label: "Inventory" },
  { href: "/store/transfers", label: "Transfers" },
  { href: "/store/purchases", label: "Purchases" },
  { href: "/store/supplier-returns", label: "Supplier returns" },
];

const MANAGER_ONLY_LINKS: NavLink[] = [{ href: "/store/reports", label: "Reports" }];

const COMPANY_LINKS: NavLink[] = [
  { href: "/company/stores", label: "Stores" },
  { href: "/company/products", label: "Products" },
  { href: "/company/categories", label: "Categories" },
  { href: "/company/suppliers", label: "Suppliers" },
  { href: "/company/users", label: "Users" },
  { href: "/company/audit-log", label: "Audit log" },
];

// "/store" and "/company" are section roots and must match exactly, otherwise
// "/store/pos" would light up Dashboard as well.
function isActive(pathname: string, href: string): boolean {
  if (href === "/store" || href === "/company") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const isManagerOrAdmin = role === "company_admin" || role === "store_manager";
  const links = isManagerOrAdmin
    ? [...STORE_LINKS, ...MANAGER_ONLY_LINKS, ...COMPANY_LINKS]
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
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
