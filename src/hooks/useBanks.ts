"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

export type BankOption = {
  id: number;
  bankName: string;
  initialBalance: number;
  remainingBalance: number;
  isActive: boolean;
};

/**
 * The payment-method list every money form on the store side renders from.
 *
 * The vocabulary lives in the `bank_info` table rather than in a hard-coded
 * array, so adding a row there is all it takes for the name to appear on the
 * POS tender, the purchase method and the ledger's "paid by" dropdown - there is
 * no second place to update and no way for one dropdown to drift from another.
 *
 * Returns an empty list on failure rather than throwing: a dropdown with no
 * options is a clear, non-destructive state, and the form's own submit will be
 * rejected by the server with a translated message. Surfacing the fetch error
 * here instead would blank the whole page over a secondary lookup.
 */
export function useBanks(): { banks: BankOption[]; loading: boolean } {
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<{ banks: BankOption[] }>("/api/store/banks")
      .then((data) => {
        if (active) setBanks(data.banks);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { banks, loading };
}
