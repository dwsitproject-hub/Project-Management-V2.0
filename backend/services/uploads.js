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
    const mount = await uploadsHealth();
    if (!mount.ok) {
      console.error(`[UPLOADS] !!! ${mount.error}. /health/ready stays 503 until the share is mounted.`);
      return false;
    }
    console.log(`[UPLOADS] Documents folder OK: ${UPLOADS_DIR}${mount.fs ? ` (${mount.fs} mount)` : ''}`);
    return true;
  } catch (e) {
    console.error(`[UPLOADS] !!! Documents folder ${UPLOADS_DIR} is NOT writable (${e.code || e.message}). ` +
      'Uploads will fail. Is the shared (Synology) folder mounted?');
    return false;
  }
}

// statfs() type numbers of network file systems (linux/magic.h).
const NETWORK_FS = new Map([
  [0xff534d42, 'cifs'],
  [0xfe534d42, 'smb2'],
  [0x517b, 'smb'],
  [0x6969, 'nfs'],
]);
const REQUIRE_NETWORK_FS = String(process.env.UPLOADS_REQUIRE_NETWORK_FS || '').toLowerCase() === 'true';

/**
 * With UPLOADS_REQUIRE_NETWORK_FS=true, UPLOADS_DIR must be the shared (Synology / NFS)
 * mount. Docker silently bind-mounts an EMPTY local folder when the host mount is
 * missing; that node would then keep its uploads to itself and lose them later. Used at
 * start-up and by /health/ready, so such a node gets no traffic. A hung mount answers
 * "not ready" after 2 s instead of hanging the health check.
 */
export async function uploadsHealth() {
  if (!REQUIRE_NETWORK_FS) return { ok: true };
  let timer;
  try {
    const st = await Promise.race([
      fs.statfs(UPLOADS_DIR),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no answer in 2000 ms')), 2000); }),
    ]);
    const kind = NETWORK_FS.get(Number(st.type));
    return kind ? { ok: true, fs: kind } : { ok: false, error: `${UPLOADS_DIR} is a local folder, not the shared mount` };
  } catch (e) {
    return { ok: false, error: `${UPLOADS_DIR}: ${e.code || e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function exists(p) {
  return fs.access(p).then(() => true, () => false);
}
