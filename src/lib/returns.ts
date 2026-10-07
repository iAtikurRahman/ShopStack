/**
 * Refund maths, shared by the returns API and the client-side preview on the
 * returns page so the figure the cashier sees while typing is the same number
 * the server will actually store.
 */

type DecimalLike = string | number | { toString(): string };

function toNum(value: DecimalLike): number {
  return Number(typeof value === "object" ? value.toString() : value);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type RefundableSaleItem = {
  id: number;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  discountAmount: DecimalLike;
  lineTotal: DecimalLike;
};

export type RefundableSale = {
  subtotal: DecimalLike;
  discountAmount: DecimalLike;
  taxAmount: DecimalLike;
  totalAmount: DecimalLike;
  items: RefundableSaleItem[];
};

/**
 * What the customer actually paid for the selected units - not the sticker
 * price. `unitPrice` is pre-discount, so multiplying it by quantity over-refunds
 * whenever a line discount or an order-level discount was applied. The order
 * discount and tax are apportioned across lines pro-rata by line value, then
 * spread evenly over the units in that line.
 */
export function computeRefundAmount(
  sale: RefundableSale,
  selections: { saleItemId: number; quantity: number }[]
): number {
  const subtotal = toNum(sale.subtotal);
  let total = 0;

  for (const selection of selections) {
    const item = sale.items.find((i) => i.id === selection.saleItemId);
    if (!item) continue;

    const lineShare = subtotal > 0 ? toNum(item.lineTotal) / subtotal : 0;
    const orderDiscountShare = toNum(sale.discountAmount) * lineShare;
    const taxShare = toNum(sale.taxAmount) * lineShare;
    const linePaid = toNum(item.lineTotal) - orderDiscountShare + taxShare;
    const lineQty = toNum(item.quantity);
    const perUnit = lineQty > 0 ? linePaid / lineQty : 0;

    total += perUnit * selection.quantity;
  }

  return round2(total);
}
