import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import {
  ExpenditureError,
  deleteExpenditureHead,
  updateExpenditureHead,
} from "@/lib/expenditures";

function badId() {
  return NextResponse.json({ message: "Invalid expenditure head id" }, { status: 400 });
}

export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return badId();
  const body = (await request.json().catch(() => null)) ?? {};
  try {
    const head = await updateExpenditureHead(db, session, id, body);
    return NextResponse.json({ head });
  } catch (err) {
    if (err instanceof ExpenditureError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

// Refused once anything has been spent against the head - see
// deleteExpenditureHead. Deactivating is the reversible answer and already takes
// it out of the dropdown.
export const DELETE = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return badId();
  try {
    return NextResponse.json(await deleteExpenditureHead(db, session, id));
  } catch (err) {
    if (err instanceof ExpenditureError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });