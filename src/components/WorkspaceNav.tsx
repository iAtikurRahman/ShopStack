import Link from "next/link";
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
  { href: "/company/subscription", label: "Subscription" },
  { href: "/company/audit-log", label: "Audit log" },
];

export function WorkspaceNav({ role }: { role: Role }) {
  const isManagerOrAdmin = role === "company_admin" || role === "store_manager";
  const links = isManagerOrAdmin
    ? [...STORE_LINKS, ...MANAGER_ONLY_LINKS, ...COMPANY_LINKS]
    : [...STORE_LINKS];

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-700">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="hover:underline">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}