// Where uploaded documents live.
//
// UPLOADS_DIR (default <cwd>/uploads, i.e. /app/uploads in the container) must be the
// SAME shared folder on every backend node — on staging / production the Synology
// share mounted into the container — so a file uploaded through one node can be
// downloaded through another.
import fs from 'fs/promises';
import path from 'path';

export const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'));

/**
 * A stored document's file on disk. Documents keep the absolute path they were saved
 * at; if that path no longer exists (the folder moved, e.g. a new UPLOADS_DIR or
 * mount point), the same file name inside UPLOADS_DIR is used instead.
 */
export async function resolveDocumentPath(storedPath) {
  if (!storedPath) return null;
  if (await exists(storedPath)) return storedPath;
  const moved = path.join(UPLOADS_DIR, path.basename(storedPath));
  return (await exists(moved)) ? moved : null;
}

/**
 * Called once at start-up: makes sure UPLOADS_DIR exists and is writable, and says so
 * loudly in the log if not (e.g. the Synology share is not mounted), instead of
 * failing later on the first upload.
 */
export async function checkUploadsDir() {
  const probe = path.join(UPLOADS_DIR, `.write-check-${process.pid}-${Date.now()}`);
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    console.log(`[UPLOADS] Documents folder OK: ${UPLOADS_DIR}`);
    return true;
  } catch (e) {
    console.error(`[UPLOADS] !!! Documents folder ${UPLOADS_DIR} is NOT writable (${e.code || e.message}). ` +
      'Uploads will fail. Is the shared (Synology) folder mounted?');
    return false;
  }
}

async function exists(p) {
  return fs.access(p).then(() => true, () => false);
}
