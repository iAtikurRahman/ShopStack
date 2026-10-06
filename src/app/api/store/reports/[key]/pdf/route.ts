import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { pdfFilename, renderReportPdf } from "@/lib/reports/pdf";
import { runReport } from "@/lib/reports/run";
import { reportLetterhead } from "@/lib/reports/letterhead";
import { ReportError } from "@/lib/reports/types";

// pdfmake and the font files are Node-only, so this route must not be bundled
// for the edge runtime.
export const runtime = "nodejs";

/**
 * One report as a PDF.
 *
 * Same `runReport` as the JSON route, so the download is the screen's numbers
 * rather than a second opinion. The locale comes from the session, which is
 * what the signed token already carries - the PDF is in the language the user
 * is actually looking at, including the Bengali font.
 */
export const GET = withAuth<{ key: string }>(async (request: NextRequest, { db, session, params }) => {
  const { key } = params;
  const search = request.nextUrl.searchParams;
  try {
    const [report, letterhead] = await Promise.all([
      runReport(db, session, key, {
        preset: search.get("preset"),
        from: search.get("from"),
        to: search.get("to"),
      }),
      reportLetterhead(db, session),
    ]);
    const scope =
      session.storeId === null
        ? ({ kind: "all" } as const)
        : ({
            kind: "store",
            name: letterhead.name ?? `#${session.storeId}`,
          } as const);

    const pdf = await renderReportPdf(report, session.language, {
      requestedBy: session.name,
      scope,
      letterhead,
    });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFilename(report)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ReportError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}, { scope: "tenant", roles: ["company_admin"], permission: "can_view_reports" });