import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { canAccessStore } from "@/lib/tenant-access";
import type { PaymentMethod } from "@/generated/tenant";

const PAYMENT_METHODS: PaymentMethod[] = [
  "cash",
  "card",
  "bkash",
  "rocket",
  "nagad",
  "upay",
  "banglaqr",
  "other",
  "due",
];

type CheckoutItem = { productId: number; quantity: number; discountAmount?: number };
type CheckoutPayment = { method: PaymentMethod; amount: number; reference?: string };

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const {
    warehouseId,
    customerId,
    items,
    payments,
    discountAmount = 0,
  }: {
    warehouseId?: number;
    customerId?: number;
    items?: CheckoutItem[];
    payments?: CheckoutPayment[];
    discountAmount?: number;
  } = body ?? {};

  if (!warehouseId || !Array.isArray(items) || items.length === 0 || !Array.isArray(payments) || payments.length === 0) {
    return NextResponse.json(
      { message: "warehouseId, a non-empty items array, and a non-empty payments array are required" },
      { status: 400 }
    );
  }

  const unknownMethod = payments.find((p) => !PAYMENT_METHODS.includes(p.method));
  if (unknownMethod) {
    return NextResponse.json({ message: `Unknown payment method: ${unknownMethod.method}` }, { status: 400 });
  }

  const warehouse = await db.warehouse.findUnique({ where: { id: Number(warehouseId) } });
  if (!warehouse || !canAccessStore(session, warehouse.storeId)) {
    return NextResponse.json({ message: "Warehouse not found in your store" }, { status: 404 });
  }

  try {
    const sale = await db.$transaction(async (tx) => {
      let subtotal = 0;
      let taxAmount = 0;
      const saleItemsData: {
        productId: number;
        quantity: number;
        unitPrice: number;
        discountAmount: number;
        lineTotal: number;
      }[] = [];

      for (const item of items) {
        const quantity = Number(item.quantity);
        const productId = Number(item.productId);
        const itemDiscount = Number(item.discountAmount ?? 0);
        if (!productId || !quantity || quantity <= 0) {
          throw new Error("Each item requires a valid productId and a positive quantity");
        }

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
          throw new Error(`Product ${productId} not found`);
        }

        const stock = await tx.warehouseStock.findUnique({
          where: { warehouseId_productId: { warehouseId: Number(warehouseId), productId } },
        });
        if (!stock || stock.quantity < quantity) {
          throw new Error(`Insufficient stock for product ${productId}`);
        }

        await tx.warehouseStock.update({
          where: { warehouseId_productId: { warehouseId: Number(warehouseId), productId } },
          data: { quantity: { decrement: quantity } },
        });

        const unitPrice = Number(product.salePrice);
        const lineSubtotal = round2(unitPrice * quantity - itemDiscount);
        const lineTax = round2(lineSubtotal * (Number(product.taxRate) / 100));
        subtotal = round2(subtotal + lineSubtotal);
        taxAmount = round2(taxAmount + lineTax);

        saleItemsData.push({
          productId,
          quantity,
          unitPrice,
          discountAmount: itemDiscount,
          lineTotal: lineSubtotal,
        });
      }

      // Clamp so an oversized discount can never make the sale total negative
      // and disagree with the amount the cashier collected.
      const totalAmount = round2(Math.max(0, subtotal - Number(discountAmount)) + taxAmount);

      // A `due` payment means no money changed hands: the whole total is owed by
      // the customer and lands on Customer.dueAmount. Mixing it with a real
      // tender in one sale is rejected rather than guessed at, because the two
      // halves would have to settle against different balances.
      const duePayments = payments.filter((p) => p.method === "due");
      const settledPayments = payments.filter((p) => p.method !== "due");
      const isDueSale = duePayments.length > 0;

      if (isDueSale && settledPayments.length > 0) {
        throw new Error("A due payment cannot be combined with another payment method");
      }
      if (isDueSale && !customerId) {
        throw new Error("A customer is required to record a due sale");
      }

      if (isDueSale) {
        // The due owed is the sale total, never the amount the client sent -
        // otherwise a tampered request could write an arbitrary figure onto the
        // customer's balance.
        const sentAmount = round2(duePayments.reduce((sum, p) => sum + Number(p.amount), 0));
        if (sentAmount !== totalAmount) {
          throw new Error(`Due amount ${sentAmount} does not match sale total ${totalAmount}`);
        }
      } else {
        const paymentsTotal = round2(settledPayments.reduce((sum, p) => sum + Number(p.amount), 0));
        if (paymentsTotal !== totalAmount) {
          throw new Error(`Payments total ${paymentsTotal} does not match sale total ${totalAmount}`);
        }
      }

      const created = await tx.sale.create({
        data: {
          storeId: warehouse.storeId,
          warehouseId: Number(warehouseId),
          cashierId: session.userId,
          customerId: customerId ? Number(customerId) : null,
          subtotal,
          discountAmount: Number(discountAmount),
          taxAmount,
          totalAmount,
          items: { create: saleItemsData },
          // Only real tenders get a SalePayment row. A due sale writes none -
          // a payment row reads as "money received", and none was.
          payments: {
            create: settledPayments.map((p) => ({
              method: p.method,
              amount: Number(p.amount),
              reference: p.reference,
            })),
          },
        },
        include: { items: true, payments: true },
      });

      if (customerId) {
        await tx.customer.update({
          where: { id: Number(customerId) },
          data: isDueSale
            ? {
                loyaltyPoints: { increment: Math.floor(totalAmount) },
                dueAmount: { increment: totalAmount },
              }
            : { loyaltyPoints: { increment: Math.floor(totalAmount) } },
        });
      }

      await writeAuditLog(tx, session, {
        action: "sale.created",
        entityType: "Sale",
        entityId: created.id,
        after: {
          totalAmount,
          itemCount: saleItemsData.length,
          paymentMethod: isDueSale ? "due" : settledPayments[0]?.method,
          dueAdded: isDueSale ? totalAmount : 0,
        },
      });

      return created;
    });

    return NextResponse.json({ sale }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_process_sales" });
