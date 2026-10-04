import Image from "next/image";

/**
 * The head of a printed report, read top to bottom like a bill: which report
 * this is, then whose figures they are - the shop's picture, the shop's name,
 * where the shop is - and only then the table itself.
 *
 * Invoice-shaped on purpose: a report that has to be filed, or handed to a
 * supplier, has to say whose figures these are before it says what the figures
 * are. Stacked rather than side by side so a long Bengali shop name or address
 * gets the full width instead of a narrow column. The same details are embedded
 * in the PDF download, so the printed page and the downloaded file agree.
 *
 * Every string arrives resolved: this is the one place that decides what a
 * letterhead looks like, not what it says, so the print page and the PDF can
 * fill it from the same session without either of them owning the wording.
 */
export function ReportLetterheadView({
  logoUrl,
  logoAlt,
  heading,
  contact,
  title,
  periodLine,
  issuedLine,
}: {
  logoUrl: string | null;
  logoAlt: string;
  /** Store name, or "All stores" for a company-wide report. */
  heading: string;
  /** Address and phone, already joined, or "" when the store has neither. */
  contact: string;
  title: string;
  periodLine: string;
  issuedLine: string;
}) {
  return (
    <header className="print-letterhead mb-6 border-2 border-slate-800 p-4 text-center">
      <h1 className="text-xl font-semibold text-slate-950">{title}</h1>
      <p className="mt-1 text-xs text-slate-600">{periodLine}</p>

      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={logoAlt}
          width={80}
          height={80}
          className="mx-auto mt-4 h-20 w-20 border border-slate-200 object-cover"
        />
      ) : null}

      <p className="mt-4 text-lg font-semibold uppercase tracking-wide text-slate-900">{heading}</p>
      {contact ? <p className="text-xs text-slate-600">{contact}</p> : null}
    </header>
  );
}