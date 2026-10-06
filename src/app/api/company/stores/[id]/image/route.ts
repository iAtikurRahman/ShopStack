import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit";
import { canAccessStore } from "@/lib/tenant-access";
import { UploadError, deleteStoredImage, saveImage } from "@/lib/uploads";

type ImageRouteContext = { id: string };

/**
 * Store images live on disk, not in the database, so this route is the only
 * place a store's picture can change. Keeping it out of the JSON PATCH also
 * means the `imageUrl` column can never be pointed at an arbitrary path.
 */
export const POST = withAuth<ImageRouteContext>(async (request, { session, db, params }) => {
  const storeId = Number(params.id);
  if (!Number.isInteger(storeId) || storeId < 1) {
    return NextResponse.json({ message: "Invalid store id" }, { status: 400 });
  }
  // Answering 404 rather than 403: a store manager should not learn that some
  // other store exists.
  if (!canAccessStore(session, storeId)) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const before = await db.store.findUnique({ where: { id: storeId } });
  if (!before) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "An image file is required" }, { status: 400 });
  }

  let imageUrl: string;
  try {
    imageUrl = await saveImage(file, `company-${session.companyId}/stores`);
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }

  let store;
  try {
    store = await db.store.update({ where: { id: storeId }, data: { imageUrl } });
  } catch (err) {
    // Nothing references the new file yet, so dropping it here leaves no orphan.
    await deleteStoredImage(imageUrl);
    throw err;
  }

  await writeAuditLog(db, session, {
    action: "store.updated",
    entityType: "Store",
    entityId: store.id,
    before: { imageUrl: before.imageUrl },
    after: { imageUrl: store.imageUrl },
  });

  // The previous file is only unlinked once the row points somewhere new, so a
  // failure above leaves the store showing the image it already had.
  await deleteStoredImage(before.imageUrl);

  return NextResponse.json({ store });
}, { scope: "tenant", roles: ["company_admin"] });

export const DELETE = withAuth<ImageRouteContext>(async (_request, { session, db, params }) => {
  const storeId = Number(params.id);
  if (!Number.isInteger(storeId) || storeId < 1) {
    return NextResponse.json({ message: "Invalid store id" }, { status: 400 });
  }
  if (!canAccessStore(session, storeId)) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const before = await db.store.findUnique({ where: { id: storeId } });
  if (!before) {
    return NextResponse.json({ message: "Store not found" }, { status: 404 });
  }

  const store = await db.store.update({ where: { id: storeId }, data: { imageUrl: null } });

  await writeAuditLog(db, session, {
    action: "store.updated",
    entityType: "Store",
    entityId: store.id,
    before: { imageUrl: before.imageUrl },
    after: { imageUrl: null },
  });

  await deleteStoredImage(before.imageUrl);

  return NextResponse.json({ store });
}, { scope: "tenant", roles: ["company_admin"] });