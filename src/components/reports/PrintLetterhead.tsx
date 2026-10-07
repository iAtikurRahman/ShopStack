import type { ReportLetterhead } from "@/lib/reports/letterhead";

/**
 * The head of a printed page: whose figures these are, before the figures.
 *
 * It is print-only on purpose - the app already carries its own header on
 * screen, so repeating the company and store there would only compete with it.
 * On paper, though, a page that opens straight into a table reads as a stray
 * sheet, so the company, the store and their contact details come first.
 */
export function PrintLetterhead({ letterhead }: { letterhead: ReportLetterhead | null }) {
  if (!letterhead) return null;

  const contact = [letterhead.address, letterhead.phone].filter(Boolean).join(" · ");
  const heading = letterhead.companyName || letterhead.name || "";
  if (!heading && !letterhead.name && !contact) return null;

  return (
    <header className="print-letterhead mb-6 hidden text-center print:block">
      {heading ? <h2 className="text-lg font-semibold text-slate-950">{heading}</h2> : null}
      {letterhead.name && letterhead.name !== heading ? (
        <p className="text-sm font-medium text-slate-800">{letterhead.name}</p>
      ) : null}
      {contact ? <p className="mt-0.5 text-xs text-slate-600">{contact}</p> : null}
    </header>
  );
}
