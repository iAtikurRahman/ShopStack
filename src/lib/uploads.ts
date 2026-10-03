import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Uploaded images are written to disk under public/uploads and served back as
 * ordinary static files. The folder is already in .gitignore, so nothing a
 * user uploads ever reaches the repository.
 *
 * Every company's files live under their own `company-<id>` folder: the folder
 * name comes from the signed session, never from the request body, so one
 * tenant can never write into another's folder.
 */
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

/** Public path prefix, and the only prefix a stored value is allowed to have. */
const PUBLIC_PREFIX = "/uploads/";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * MIME type -> extension. The type the browser reports is the key, so a file
 * renamed to `.png` while actually being something else is still rejected.
 * SVG is deliberately absent: it can carry script, and it is not an image the
 * optimiser will serve.
 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class UploadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Writes an uploaded image into `folder` (relative to the uploads root) and
 * returns the public path to store on the row. The file name is generated, not
 * taken from the client, so it can neither collide nor carry a path.
 */
export async function saveImage(file: File, folder: string): Promise<string> {
  const extension = IMAGE_EXTENSIONS[file.type];
  if (!extension) {
    throw new UploadError(400, "Image must be a JPG, PNG, WebP or GIF file");
  }
  if (file.size === 0) {
    throw new UploadError(400, "The chosen file is empty");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new UploadError(400, "Image must be 2 MB or smaller");
  }

  const directory = path.join(UPLOADS_DIR, folder);
  await mkdir(directory, { recursive: true });

  // The timestamp keeps successive uploads of the same store apart in a
  // directory listing; the random suffix means two uploads landing in the same
  // millisecond cannot overwrite each other.
  const name = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
  await writeFile(path.join(directory, name), Buffer.from(await file.arrayBuffer()));

  return `${PUBLIC_PREFIX}${folder}/${name}`;
}

/**
 * Removes a previously stored image. Best-effort: the row has already stopped
 * pointing at the file by the time this runs, so a file that cannot be deleted
 * (already gone, or a permission problem) must not fail the request.
 */
export async function deleteStoredImage(publicUrl: string | null | undefined): Promise<void> {
  const absolutePath = resolveStoredImage(publicUrl);
  if (!absolutePath) return;
  await unlink(absolutePath).catch(() => {});
}

/**
 * Maps a stored public path back to a file on disk, or null when the value is
 * not one this app wrote. Resolving first and re-checking the prefix is what
 * stops a crafted "../../etc/passwd" from escaping the uploads folder.
 */
function resolveStoredImage(publicUrl: string | null | undefined): string | null {
  if (typeof publicUrl !== "string" || !publicUrl.startsWith(PUBLIC_PREFIX)) return null;

  const absolutePath = path.resolve(UPLOADS_DIR, publicUrl.slice(PUBLIC_PREFIX.length));
  if (absolutePath !== UPLOADS_DIR && !absolutePath.startsWith(UPLOADS_DIR + path.sep)) {
    return null;
  }
  return absolutePath;
}