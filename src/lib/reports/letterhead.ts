import type { PrismaClient } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";

/**
 * Who the report is for, on paper.
 *
 * A printed report or a PDF that opens with nothing but a table reads as a
 * stray spreadsheet: the shop's name, address and logo are what make it a
 * document that can be filed. Both renderers take it from here, so the print
 * page and the PDF carry the same letterhead rather than each inventing one.
 *
 * Store name/address/phone/image live on the tenant `Store`, and the company
 * name on the tenant `TenantConfig`. A company_admin asking for a company-wide
 * report has no single store to print, so the store half is left out rather
 * than borrowing one of them.
 */
export type ReportLetterhead = {
  kind: "store" | "all";
  /** The company that owns the store; the document's main heading. */
  companyName: string;
  /** The store's own name; null for a company-wide report. */
  name: string | null;
  address: string | null;
  phone: string | null;
  /** Public path of the store picture, e.g. "/uploads/company-1/stores/x.png". */
  imageUrl: string | null;
};

const EMPTY: ReportLetterhead = {
  kind: "all",
  companyName: "",
  name: null,
  address: null,
  phone: null,
  imageUrl: null,
};

export async function reportLetterhead(
  db: PrismaClient,
  session: TenantSession
): Promise<ReportLetterhead> {
  // The tenant database carries its own copy of the company name, so the
  // letterhead needs nothing beyond the client it is already handed.
  const config = await db.tenantConfig.findUnique({
    where: { id: 1 },
    select: { companyName: true },
  });
  const companyName = config?.companyName ?? "";
  if (session.storeId === null) return { ...EMPTY, companyName };
  const store = await db.store.findFirst({
    where: { id: session.storeId },
    select: { name: true, address: true, phone: true, imageUrl: true },
  });
  if (!store) return { ...EMPTY, companyName };
  return {
    kind: "store",
    companyName,
    name: store.name,
    address: store.address,
    phone: store.phone,
    imageUrl: store.imageUrl,
  };
}

/**
 * The two strings a letterhead prints, worked out once so the page and the PDF
 * cannot word the head of the document differently.
 *
 * The heading names the company first and the store inside it - "BadhonByte
 * (Main Store)" - because that is the order a reader needs: who this belongs
 * to, then which branch. A company-wide report has no branch, so its heading is
 * the company alone and the line below says which stores it covers.
 */
export function letterheadLines(
  letterhead: ReportLetterhead,
  labels: { allStores: string }
): { heading: string; contact: string } {
  const heading =
    letterhead.kind === "store" && letterhead.name
      ? letterhead.companyName
        ? `${letterhead.companyName} (${letterhead.name})`
        : letterhead.name
      : letterhead.companyName || labels.allStores;

  const contact = [
    letterhead.kind === "all" ? labels.allStores : null,
    [letterhead.address, letterhead.phone].filter(Boolean).join(" · ") || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { heading, contact };
}