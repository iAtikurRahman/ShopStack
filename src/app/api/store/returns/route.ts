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
        { message: `Refund cannot exceed the sale total of $${saleTotal.toFixed(2)}` },
        { status: 400 }
      );
    }
    refundOverride = round2(amount);
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const returnItemsData: { saleItemId: number; quantity: number; restocked: boolean }[] = [];

      for (const item of items) {
        const quantity = Number(item.quantity);
        const saleItemId = Number(item.saleItemId);
        if (!saleItemId || !quantity || quantity <= 0) {
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
        const remaining = saleItem.quantity - (alreadyReturned._sum.quantity ?? 0);
        if (quantity > remaining) {
          throw new Error(`Only ${remaining} unit(s) of sale item ${saleItemId} remain returnable`);
        }

        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: sale.warehouseId, productId: saleItem.productId } },
          update: { quantity: { increment: quantity } },
          create: { warehouseId: sale.warehouseId, productId: saleItem.productId, quantity },
        });

        returnItemsData.push({ saleItemId, quantity, restocked: true });
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

      const totalOriginalQty = sale.items.reduce((sum, si) => sum + si.quantity, 0);
      const saleItemIds = sale.items.map((si) => si.id);
      const totalReturnedAgg = await tx.returnItem.groupBy({
        by: ["saleItemId"],
        where: { saleItemId: { in: saleItemIds } },
        _sum: { quantity: true },
      });
      const totalReturnedQty = totalReturnedAgg.reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: totalReturnedQty >= totalOriginalQty ? "refunded" : "partially_refunded" },
      });

      await writeAuditLog(tx, session, {
        action: "return.created",
        entityType: "Return",
        entityId: createdReturn.id,
        after: { saleId: sale.id, refundAmount },
      });

      return createdReturn;
    });

    return NextResponse.json({ return: result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Return failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_process_returns" });
