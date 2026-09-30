/**
 * Opening balances for a party that is being added to the system.
 *
 * "Previous due" is money that was already owed before we started tracking it -
 * a customer who had a tab running at the old shop, or a supplier we were
 * already behind on. It is seeded straight onto Customer.dueAmount /
 * Supplier.dueAmount so the party starts life with the balance they actually
 * have, rather than 0 plus whatever gets added after.
 *
 * It is NOT a payment and NOT a return, so it deliberately never writes a
 * Payment row: there is no transaction id to reference and no method the money
 * moved by.
 */

import { round2 } from "./returns";

/**
 * Optional and never negative. A negative "previous due" would quietly mean
 * "we owe them" - the opposite of the field's job - so it is rejected rather
 * than stored; that has to be booked as a payment instead.
 *
 * Blank, null and undefined all mean "nothing outstanding yet" (0), which is
 * what an untouched optional field should do.
 */
export function parseOpeningDue(raw: unknown): { value: number } | { error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { value: 0 };
  }

  // Only a real number or a numeric string. Without this, JSON like
  // `previousDue: ["5"]` would coerce to 5 and `previousDue: []` to 0, because
  // Number() happily reads those as numbers.
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { error: "previousDue must be zero or greater" };
  }

  const value = Number(raw);
  if (typeof raw === "string" && raw.trim() === "") {
    return { value: 0 };
  }
  if (!Number.isFinite(value) || value < 0) {
    return { error: "previousDue must be zero or greater" };
  }

  return { value: round2(value) };
}
