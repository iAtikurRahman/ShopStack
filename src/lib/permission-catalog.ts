/**
 * Fixed catalog of granular permission keys, seeded into every tenant
 * database's Permission table at provisioning time. Role-default grants
 * (which roles get which of these by default) live in permissions.ts -
 * this file only defines what a valid permission key is.
 */
export const PERMISSION_CATALOG = [
  { key: "can_manage_users", label: "Manage users", description: "Create, update, and deactivate store users" },
  { key: "can_manage_inventory", label: "Manage inventory", description: "Adjust stock levels and stock transfers" },
  { key: "can_process_returns", label: "Process returns", description: "Process full/partial returns and refunds" },
  { key: "can_view_reports", label: "View reports", description: "View sales, inventory, and staff performance reports" },
  { key: "can_manage_products", label: "Manage products", description: "Create, update, and deactivate products and categories" },
  { key: "can_process_sales", label: "Process sales", description: "Use the POS checkout screen" },
  { key: "can_manage_customers", label: "Manage customers", description: "Create and edit customer profiles" },
  // Granular per-action product permissions, scoped to a store_user's own
  // store's warehouse(s) via /api/store/warehouses/[id]/products and
  // /api/store/products/[id] - finer-grained than can_manage_products
  // (which is the company_admin catalog-wide equivalent) so a Store
  // Manager can grant e.g. view+create without delete to a given user.
  { key: "product.view", label: "View warehouse products", description: "View products stocked in their warehouse" },
  { key: "product.create", label: "Create warehouse products", description: "Add new products to their warehouse" },
  { key: "product.update", label: "Update warehouse products", description: "Edit product details for their warehouse" },
  { key: "product.delete", label: "Delete warehouse products", description: "Remove products from their warehouse" },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];
