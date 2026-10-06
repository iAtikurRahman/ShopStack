import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { canAccessStore, storeScopeWhere } from "@/lib/tenant-access";
import { DUE_METHOD, applyBankDelta, requireSettlementMethod } from "@/lib/banks";

export const GET = withAuth(async (request, { session, db }) => {
  const warehouses = await db.warehouse.findMany({ where: storeScopeWhere(session) });
  const warehouseIds = warehouses.map((w) => w.id);

  // Used by purchase-return: look up a delivery by its purchase number or its
  // reference / invoice no. (the loose "supply number"). When the query param
  // is absent the whole store's history is returned as before.
  const lookup = new URL(request.url).searchParams.get("lookup")?.trim() ?? "";

  // A purchase can be spread across warehouses, so show it if any of its
  // lines landed in one of this store's warehouses.
  const scope = {
    OR: [
      { warehouseId: { in: warehouseIds } },
      { items: { some: { warehouseId: { in: warehouseIds } } } },
    ],
  };
  const lookups = lookup
    ? [
        ...(/^\d+$/.test(lookup) ? [{ id: Number(lookup) }] : []),
        { reference: lookup },
      ]
    : [];

  const purchases = await db.purchase.findMany({
    where: lookups.length > 0 ? { AND: [{ OR: lookups }, scope] } : scope,
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { purchasedAt: "desc" },
  });

  return NextResponse.json({ purchases });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  const { supplierId, warehouseId, reference, items, purchasedAt } = body ?? {};

  if (!supplierId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { message: "supplierId and a non-empty items array are required" },
      { status: 400 }
    );
  }

  // The payment method is a BankInfo.bankName (or "due"), resolved against the
  // database before the transaction opens - a typo costs nothing and an account
  // the owner has deactivated cannot be used for new stock.
  let paymentMethod: string;
  try {
    paymentMethod = await requireSettlementMethod(db, body?.paymentMethod ?? "cash");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown payment method";
    return NextResponse.json({ message }, { status: 400 });
  }

  const supplier = await db.supplier.findUnique({ where: { id: Number(supplierId) } });
  if (!supplier) {
    return NextResponse.json({ message: "Supplier not found" }, { status: 404 });
  }

  // Each line carries its own warehouse so one delivery from a supplier can be
  // split across warehouses. A single top-level warehouseId is still accepted
  // and applied to every line.
  const requestedWarehouseIds = [
    ...new Set(
      items
        .map((item: { warehouseId?: number }) => Number(item.warehouseId ?? warehouseId))
        .map((id: number) => (Number.isInteger(id) && id > 0 ? id : 0))
    ),
  ];
  if (requestedWarehouseIds.some((id) => id === 0)) {
    return NextResponse.json({ message: "Each item requires a warehouseId" }, { status: 400 });
  }

  const warehouses = await db.warehouse.findMany({
    where: { id: { in: requestedWarehouseIds } },
    select: { id: true, storeId: true },
  });
  if (warehouses.length !== requestedWarehouseIds.length) {
    return NextResponse.json({ message: "Warehouse not found" }, { status: 404 });
  }
  if (warehouses.some((w) => !canAccessStore(session, w.storeId))) {
    return NextResponse.json({ message: "Warehouse not found in your store" }, { status: 404 });
  }

  let parsedPurchasedAt = new Date();
  if (purchasedAt) {
    parsedPurchasedAt = new Date(purchasedAt);
    if (Number.isNaN(parsedPurchasedAt.getTime())) {
      return NextResponse.json({ message: "Invalid purchasedAt date" }, { status: 400 });
    }
    if (parsedPurchasedAt.getTime() > Date.now()) {
      return NextResponse.json({ message: "purchasedAt cannot be in the future" }, { status: 400 });
    }
  }

  try {
    const purchase = await db.$transaction(async (tx) => {
      let totalCost = 0;
      const lineItems: { productId: number; quantity: number; unitCost: number; warehouseId: number }[] = [];

      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        const unitCost = Number(item.unitCost);
        const lineWarehouseId = Number(item.warehouseId ?? warehouseId);
        if (!productId || !quantity || quantity <= 0 || Number.isNaN(unitCost) || unitCost < 0) {
          throw new Error("Each item requires a valid productId, positive quantity, and non-negative unitCost");
        }

        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: lineWarehouseId, productId } },
          update: { quantity: { increment: quantity } },
          create: { warehouseId: lineWarehouseId, productId, quantity },
        });

        totalCost += quantity * unitCost;
        lineItems.push({ productId, quantity, unitCost, warehouseId: lineWarehouseId });
      }

      // Only pin the purchase to a single warehouse when every line agrees.
      const warehouseIdsUsed = [...new Set(lineItems.map((i) => i.warehouseId))];
      const primaryWarehouseId = warehouseIdsUsed.length === 1 ? warehouseIdsUsed[0] : null;

      const created = await tx.purchase.create({
        data: {
          supplierId: Number(supplierId),
          warehouseId: primaryWarehouseId,
          receivedById: session.userId,
          reference: reference || null,
          totalCost,
          paymentMethod,
          purchasedAt: parsedPurchasedAt,
          items: { create: lineItems },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, sku: true, name: true } },
              warehouse: { select: { id: true, name: true } },
            },
          },
          supplier: { select: { id: true, name: true } },
        },
      });

      // A `due` purchase is unpaid: the delivery is booked but no money changed
      // hands, so the whole total goes onto what we owe this supplier. Inside
      // the same transaction as the purchase, so a failure here rolls the
      // stock increments back rather than leaving stock with no due behind it.
      if (paymentMethod === DUE_METHOD && totalCost > 0) {
        await tx.supplier.update({
          where: { id: Number(supplierId) },
          data: { dueAmount: { increment: totalCost } },
        });
      }

      // The mirror image of the POS: paying a supplier takes the money out of
      // the account the delivery was paid through. A `due` purchase deducts
      // nothing, because the money has not left yet.
      const bankBalance =
        paymentMethod === DUE_METHOD
          ? null
          : await applyBankDelta(tx, paymentMethod, -totalCost);

      await writeAuditLog(tx, session, {
        action: "purchase.created",
        entityType: "Purchase",
        entityId: created.id,
        after: {
          totalCost,
          paymentMethod,
          dueAdded: paymentMethod === DUE_METHOD ? totalCost : 0,
          bankBalanceAfter: bankBalance,
        },
      });

      return created;
    });

    return NextResponse.json({ purchase }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Purchase failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"], permission: "can_manage_inventory" });
