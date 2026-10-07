import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { canAccessStore, storeScopeWhere } from "@/lib/tenant-access";
import { computeRefundAmount, round2 } from "@/lib/returns";

type ReturnItemInput = { saleItemId: number; quantity: number };

export const GET = withAuth(async (_request, { session, db }) => {
  const returns = await db.return.findMany({
    where: storeScopeWhere(session),
    include: {
      items: true,
      // The sale's discount/tax breakdown is what explains a refund amount,
      // so the client can show it and cap manual edits.
      sale: {
        select: {
          id: true,
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          totalAmount: true,
          items: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ returns });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const {
    saleId,
    items,
    reason,
    refundAmount: refundAmountInput,
  }: {
    saleId?: number;
    items?: ReturnItemInput[];
    reason?: string;
    refundAmount?: number;
  } = body ?? {};

  if (!saleId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ message: "saleId and a non-empty items array are required" }, { status: 400 });
  }

  const sale = await db.sale.findUnique({ where: { id: Number(saleId) }, include: { items: true } });
  if (!sale || !canAccessStore(session, sale.storeId)) {
    return NextResponse.json({ message: "Sale not found" }, { status: 404 });
  }

  // Legacy sale lines predate the unit column; fall back to the product's
  // stock unit so their restock still lands in the right place.
  const productIds = [...new Set(sale.items.map((si) => si.productId))];
  const saleProducts = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, unit: true },
  });
  const productUnitById = new Map(saleProducts.map((p) => [p.id, p.unit]));

  // Staff negotiate discounts at the till, so the computed figure is a
  // suggestion they are allowed to override - but never above what the sale
  // actually brought in.
  let refundOverride: number | null = null;
  if (refundAmountInput !== undefined) {
    const amount = Number(refundAmountInput);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ message: "refundAmount must be zero or greater" }, { status: 400 });
    }
    const saleTotal = Number(sale.totalAmount);
    if (amount > saleTotal) {
      return NextResponse.json(
        { message: `Refund cannot exceed the sale total of ৳${saleTotal.toFixed(2)}` },
        { status: 400 }
      );
    }
    refundOverride = round2(amount);
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const returnItemsData: {
        saleItemId: number;
        quantity: number;
        unit: string;
        stockQuantity: number;
        restocked: boolean;
      }[] = [];

      for (const item of items) {
        const quantity = Number(item.quantity);
        const saleItemId = Number(item.saleItemId);
        if (!saleItemId || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("Each item requires a valid saleItemId and a positive quantity");
        }

        const saleItem = sale.items.find((si) => si.id === saleItemId);
        if (!saleItem) {
          throw new Error(`Sale item ${saleItemId} does not belong to this sale`);
        }

        const alreadyReturned = await tx.returnItem.aggregate({
          where: { saleItemId },
          _sum: { quantity: true },
        });
        const soldQty = Number(saleItem.quantity);
        const remaining = soldQty - Number(alreadyReturned._sum.quantity ?? 0);
        if (quantity > remaining) {
          throw new Error(`Only ${remaining} unit(s) of sale item ${saleItemId} remain returnable`);
        }

        // The return is entered in the same unit the customer bought, so the
        // stock unit it restocks at is the line's own stock-per-unit ratio.
        const unit = saleItem.unit ?? productUnitById.get(saleItem.productId) ?? "piece";
        const factor = soldQty > 0 ? Number(saleItem.stockQuantity) / soldQty : 1;
        const stockQuantity = round2(quantity * factor);

        // Put the goods back where they left from. Legacy lines have no
        // warehouseId, so they fall back to the sale's primary warehouse.
        const restockWarehouseId = saleItem.warehouseId ?? sale.warehouseId;
        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: restockWarehouseId, productId: saleItem.productId } },
          update: { quantity: { increment: stockQuantity } },
          create: { warehouseId: restockWarehouseId, productId: saleItem.productId, quantity: stockQuantity },
        });

        returnItemsData.push({ saleItemId, quantity, unit, stockQuantity, restocked: true });
      }

      // Refund what the customer actually paid, not the sticker price - see
      // computeRefundAmount for how the line discount, order discount and tax
      // are apportioned. A staff-supplied amount wins when one was given.
      const refundAmount = refundOverride ?? computeRefundAmount(sale, returnItemsData);

      const createdReturn = await tx.return.create({
        data: {
          saleId: sale.id,
          storeId: sale.storeId,
          warehouseId: sale.warehouseId,
          processedById: session.userId,
          reason,
          refundAmount,
          items: { create: returnItemsData },
        },
        include: { items: true },
      });

      const totalOriginalQty = sale.items.reduce((sum, si) => sum + Number(si.quantity), 0);
      const saleItemIds = sale.items.map((si) => si.id);
      const totalReturnedAgg = await tx.returnItem.groupBy({
        by: ["saleItemId"],
        where: { saleItemId: { in: saleItemIds } },
        _sum: { quantity: true },
      });
      const totalReturnedQty = totalReturnedAgg.reduce((sum, row) => sum + Number(row._sum.quantity ?? 0), 0);

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: totalReturnedQty >= totalOriginalQty ? "refunded" : "partially_refunded" },
      });

      // A refund returns money to whoever bought the sale, whether it was sold
      // on credit or paid at the till. Either way the party's remaining balance
      // comes down by the refunded amount - a credit sale stops being owed, a
      // paid sale leaves the customer with credit for the refunded money. The
      // balance is allowed to go negative (it then means "we owe them").
      const saleCustomerId = sale.customerId;
      if (saleCustomerId !== null && saleCustomerId !== undefined) {
        await tx.customer.update({
          where: { id: saleCustomerId },
          data: { dueAmount: { decrement: Number(refundAmount) } },
        });
      }

      await writeAuditLog(tx, session, {
        action: "return.created",
        entityType: "Return",
        entityId: createdReturn.id,
        after: { saleId: sale.id, refundAmount, dueReduced: Number(refundAmount) },
      });

      return createdReturn;
    });

    return NextResponse.json({ return: result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Return failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_process_returns" });
