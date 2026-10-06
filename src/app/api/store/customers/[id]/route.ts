import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { storeScopeWhere } from "@/lib/tenant-access";

export const GET = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const customerId = Number(params.id);
  if (!Number.isInteger(customerId)) {
    return NextResponse.json({ message: "Invalid customer id" }, { status: 400 });
  }

  // The customer record itself is tenant-wide (they can shop at any store),
  // but their sales are store-scoped: store staff only ever see the sales
  // made in their own store, a company_admin sees every store's sales.
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return NextResponse.json({ message: "Customer not found" }, { status: 404 });
  }

  const sales = await db.sale.findMany({
    where: { customerId, ...storeScopeWhere(session) },
    include: { items: true, returns: true, payments: true },
    orderBy: { createdAt: "desc" },
  });

  // SaleItem has no relation to Product, so the names are resolved in one
  // extra query for exactly the products this customer has bought.
  const productIds = [...new Set(sales.flatMap((sale) => sale.items.map((item) => item.productId)))];
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : [];

  // Payments are part of the party's story, not of a store's - the ledger is
  // company-wide, so this is the same set /company/payments lists for them.
  // Voided rows are included so the history reads true; the panel marks them.
  const payments = await db.payment.findMany({
    where: { type: "customer", customerSupplierId: customerId },
    orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
  });

  return NextResponse.json({ customer, sales, products, payments });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });
