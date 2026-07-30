import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";

type ReturnItemInput = { saleItemId: number; quantity: number };

export const GET = withAuth(async (_request, { session, db }) => {
  const returns = await db.return.findMany({
    where: { storeId: session.storeId ?? -1 },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ returns });
}, { scope: "tenant", roles: ["store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { saleId, items, reason }: { saleId?: number; items?: ReturnItemInput[]; reason?: string } = body ?? {};

  if (!saleId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ message: "saleId and a non-empty items array are required" }, { status: 400 });
  }

  const sale = await db.sale.findUnique({ where: { id: Number(saleId) }, include: { items: true } });
  if (!sale || sale.storeId !== session.storeId) {
    return NextResponse.json({ message: "Sale not found" }, { status: 404 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      let refundAmount = 0;
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

        refundAmount += Number(saleItem.unitPrice) * quantity;
        returnItemsData.push({ saleItemId, quantity, restocked: true });
      }
      refundAmount = Math.round(refundAmount * 100) / 100;

      const createdReturn = await tx.return.create({
        data: {
          saleId: sale.id,
          storeId: session.storeId!,
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
}, { scope: "tenant", roles: ["store_manager", "store_user"], permission: "can_process_returns" });
