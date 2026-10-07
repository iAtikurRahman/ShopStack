import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { canAccessStore } from "@/lib/tenant-access";
import { DUE_METHOD, applyBankDelta, requireSettlementMethod } from "@/lib/banks";
import { convertQuantity, normalizeUnit } from "@/lib/units";

type CheckoutItem = {
  productId: number;
  quantity: number;
  unit?: string;
  unitPrice?: number;
  discountAmount?: number;
  // Which warehouse this line's stock leaves from. Omitted means the sale's
  // primary warehouse (the whole-sale default).
  warehouseId?: number;
};
type CheckoutPayment = { method: string; amount: number; reference?: string };

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

  const warehouse = await db.warehouse.findUnique({ where: { id: Number(warehouseId) } });
  if (!warehouse || !canAccessStore(session, warehouse.storeId)) {
    return NextResponse.json({ message: "Warehouse not found in your store" }, { status: 404 });
  }

  // A line may name its own warehouse so one sale can draw the same product
  // from several. Every named warehouse must be accessible and belong to the
  // same store as the sale's primary warehouse, otherwise the sale would span
  // stores and its storeId would stop being meaningful.
  const itemWarehouseIds = [...new Set(items.map((item) => Number(item.warehouseId ?? warehouseId)))];
  const itemWarehouses = await db.warehouse.findMany({ where: { id: { in: itemWarehouseIds } } });
  const warehouseById = new Map(itemWarehouses.map((w) => [w.id, w]));
  for (const id of itemWarehouseIds) {
    const found = warehouseById.get(id);
    if (!found || !canAccessStore(session, found.storeId)) {
      return NextResponse.json({ message: "Warehouse not found in your store" }, { status: 404 });
    }
    if (found.storeId !== warehouse.storeId) {
      return NextResponse.json({ message: "All warehouses must belong to the same store" }, { status: 400 });
    }
  }

  // A payment method is a BankInfo.bankName (or "due"), so it is resolved
  // against the database rather than a hard-coded list - this is what lets a
  // company add its own methods. Done before the transaction so an unknown name
  // costs nothing.
  let methods: string[];
  try {
    methods = await Promise.all(payments.map((p) => requireSettlementMethod(db, p.method)));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown payment method";
    return NextResponse.json({ message }, { status: 400 });
  }

  try {
    const sale = await db.$transaction(async (tx) => {
      let subtotal = 0;
      let taxAmount = 0;
      const saleItemsData: {
        productId: number;
        warehouseId: number;
        quantity: number;
        unit: string;
        stockQuantity: number;
        unitPrice: number;
        discountAmount: number;
        lineTotal: number;
      }[] = [];

      for (const item of items) {
        const quantity = Number(item.quantity);
        const productId = Number(item.productId);
        const itemDiscount = Number(item.discountAmount ?? 0);
        const itemWarehouseId = Number(item.warehouseId ?? warehouseId);
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("Each item requires a valid productId and a positive quantity");
        }

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
          throw new Error(`Product ${productId} not found`);
        }

        const unit = normalizeUnit(item.unit ?? product.unit);
        const packFactor = product.unitValue ? Number(product.unitValue) : null;
        const stockQuantity = convertQuantity(quantity, unit, product.unit, packFactor);
        if (stockQuantity === null) {
          throw new Error(`Unit ${unit} does not match product ${productId}`);
        }

        const stock = await tx.warehouseStock.findUnique({
          where: { warehouseId_productId: { warehouseId: itemWarehouseId, productId } },
        });
        if (!stock || Number(stock.quantity) < stockQuantity) {
          throw new Error(`Insufficient stock for product ${productId}`);
        }

        await tx.warehouseStock.update({
          where: { warehouseId_productId: { warehouseId: itemWarehouseId, productId } },
          data: { quantity: { decrement: stockQuantity } },
        });

        // The price is per the unit the cashier chose. When omitted it falls
        // back to the product's shelf price (which is per its stock unit).
        const unitPrice =
          item.unitPrice !== undefined && item.unitPrice !== null
            ? Number(item.unitPrice)
            : Number(product.salePrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error(`Invalid price for product ${productId}`);
        }

        const lineSubtotal = round2(unitPrice * quantity - itemDiscount);
        const lineTax = round2(lineSubtotal * (Number(product.taxRate) / 100));
        subtotal = round2(subtotal + lineSubtotal);
        taxAmount = round2(taxAmount + lineTax);

        saleItemsData.push({
          productId,
          warehouseId: itemWarehouseId,
          quantity,
          unit,
          stockQuantity,
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
      //
      // `methods[i]` is the database-confirmed name for `payments[i]`, so the
      // two arrays are zipped once here and every branch below reads the
      // resolved name rather than the client's raw string.
      const tenders = payments.map((p, i) => ({ ...p, method: methods[i] }));
      const duePayments = tenders.filter((p) => p.method === DUE_METHOD);
      const settledPayments = tenders.filter((p) => p.method !== DUE_METHOD);
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

      // Money handed over at the till lands in the account it was tendered
      // through. Inside the sale's transaction, so stock cannot be decremented
      // without the cash that paid for it being recorded, and vice versa.
      // A due sale adds nothing - the money has not arrived, it is owed.
      const bankBalances: Record<string, number> = {};
      for (const tender of settledPayments) {
        bankBalances[tender.method] = await applyBankDelta(tx, tender.method, Number(tender.amount));
      }

      await writeAuditLog(tx, session, {
        action: "sale.created",
        entityType: "Sale",
        entityId: created.id,
        after: {
          totalAmount,
          itemCount: saleItemsData.length,
          paymentMethod: isDueSale ? DUE_METHOD : settledPayments[0]?.method,
          dueAdded: isDueSale ? totalAmount : 0,
          bankBalances,
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
