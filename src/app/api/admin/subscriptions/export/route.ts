import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export const GET = withAuth(async () => {
  const payments = await centralDb.subscriptionPayment.findMany({
    include: {
      company: { select: { name: true, slug: true } },
      plan: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const header = [
    "Company",
    "Slug",
    "Plan",
    "Payment Method",
    "Transaction ID",
    "Amount",
    "Status",
    "Submitted At",
    "Reviewed At",
  ];
  const rows = payments.map((p) => [
    p.company.name,
    p.company.slug,
    p.plan?.name ?? "",
    p.paymentMethod,
    p.transactionId,
    p.amount.toString(),
    p.status,
    p.createdAt.toISOString(),
    p.reviewedAt?.toISOString() ?? "",
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="subscription-report-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}, { scope: "project_admin" });
