// CR creation email ("new CR" mail to SAP support), sent once per CR.
//
// It used to be a 10-minute setTimeout plus a flag in process memory. That only works
// with ONE backend process: on two HA nodes the upload hitting the other node either
// sent a second email or none, and any restart inside those 10 minutes lost it. Now
// the pending email is a row in "crEmailQueue" and every node runs a small sweeper that
// claims due rows with FOR UPDATE SKIP LOCKED, so each email is sent exactly once,
// whichever node handles the requests, and survives restarts.
//
// Timing (same as before for the user):
//   - an eligible CR is created  -> email due in 10 minutes (if no documents come)
//   - a document is uploaded     -> email due ~15 s after the LAST upload, so every
//                                   file uploaded with the CR is attached
import store from '../store.js';
import { sendCRCreationEmail } from './email.js';
import { initiativeTriggersCrCreationEmail } from './cr-email-eligibility.js';
import { resolveDocumentPath } from './uploads.js';

const { pool } = store;

const WAIT_FOR_DOCUMENTS_MS = 10 * 60 * 1000; // send without documents after 10 minutes
const AFTER_UPLOAD_MS = Number(process.env.CR_EMAIL_AFTER_UPLOAD_MS ?? 15000);
const SWEEP_EVERY_MS = Number(process.env.CR_EMAIL_SWEEP_MS ?? 10000);
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const STUCK_AFTER_MS = 10 * 60 * 1000; // a 'sending' row whose node died mid-send

/** Queue the email for a newly created CR (call only when it is eligible). */
export async function queueCrCreationEmail(initiativeId) {
  await pool.query(
    `INSERT INTO "crEmailQueue"("initiativeId", "status", "dueAt")
     VALUES ($1, 'pending', now() + ($2 || ' milliseconds')::interval)
     ON CONFLICT ("initiativeId") DO NOTHING`,
    [initiativeId, String(WAIT_FOR_DOCUMENTS_MS)],
  );
}

/**
 * A document was uploaded to this initiative: if its creation email is still waiting,
 * send it shortly (after the rest of the batch has uploaded). No-op otherwise — the
 * email was already sent, or the initiative never needed one.
 */
export async function crDocumentUploaded(initiativeId) {
  const res = await pool.query(
    `UPDATE "crEmailQueue" SET "dueAt" = now() + ($2 || ' milliseconds')::interval
     WHERE "initiativeId" = $1 AND "status" = 'pending'`,
    [initiativeId, String(AFTER_UPLOAD_MS)],
  );
  return res.rowCount > 0;
}

/** Claims due emails (at most `limit`) for this node; other nodes skip them. */
async function claimDue(limit = 5) {
  const res = await pool.query(
    `UPDATE "crEmailQueue" q
        SET "status" = 'sending', "attempts" = q."attempts" + 1, "claimedAt" = now()
      WHERE q."initiativeId" IN (
        SELECT "initiativeId" FROM "crEmailQueue"
         WHERE ("status" = 'pending' AND "dueAt" <= now())
            OR ("status" = 'sending' AND "claimedAt" < now() - ($2 || ' milliseconds')::interval)
         ORDER BY "dueAt"
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING q."initiativeId", q."attempts"`,
    [limit, String(STUCK_AFTER_MS)],
  );
  return res.rows;
}

async function finish(initiativeId, status, error = null) {
  await pool.query(
    `UPDATE "crEmailQueue"
        SET "status" = $2, "lastError" = $3, "sentAt" = CASE WHEN $2 = 'sent' THEN now() ELSE "sentAt" END
      WHERE "initiativeId" = $1`,
    [initiativeId, status, error],
  );
}

async function retryLater(initiativeId, error) {
  await pool.query(
    `UPDATE "crEmailQueue"
        SET "status" = 'pending', "dueAt" = now() + ($2 || ' milliseconds')::interval, "lastError" = $3
      WHERE "initiativeId" = $1`,
    [initiativeId, String(RETRY_AFTER_MS), error],
  );
}

/** Sends one claimed email. Returns the outcome for logging / tests. */
async function sendOne({ initiativeId, attempts }) {
  try {
    const data = await store.read();
    const initiative = (data.initiatives || []).find((i) => i.id === initiativeId);
    // The CR may have been deleted, or edited so it no longer concerns SAP.
    if (!initiative || initiative.type !== 'CR' || !initiativeTriggersCrCreationEmail(data, initiative)) {
      await finish(initiativeId, 'skipped');
      console.log(`[CR EMAIL] Skipped ${initiativeId}: no longer a SAP FICO / SAP NON FICO CR`);
      return 'skipped';
    }
    const documents = [];
    for (const d of (data.documents || []).filter((x) => x.initiativeId === initiativeId)) {
      const filePath = await resolveDocumentPath(d.filePath);
      if (filePath) documents.push({ ...d, filePath });
    }
    const userLookups = (data.users || []).map((u) => ({ id: u.id, name: u.name, email: u.email || null }));
    const crData = {
      name: initiative.name,
      description: initiative.description,
      businessImpact: initiative.businessImpact,
      priority: initiative.priority,
      businessOwnerId: initiative.businessOwnerId,
      businessUserIds: initiative.businessUserIds,
      itPicId: initiative.itPicId,
      itPicIds: initiative.itPicIds,
      itManagerIds: initiative.itManagerIds,
    };
    console.log(`[CR EMAIL] Sending for CR "${initiative.name}" with ${documents.length} document(s)`);
    const ok = await sendCRCreationEmail(crData, userLookups, documents);
    if (!ok) throw new Error('sendCRCreationEmail returned false');
    await finish(initiativeId, 'sent');
    return 'sent';
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    if (attempts >= MAX_ATTEMPTS) {
      await finish(initiativeId, 'failed', msg).catch(() => {});
      console.error(`[CR EMAIL] Giving up on ${initiativeId} after ${attempts} attempts: ${msg}`);
      return 'failed';
    }
    await retryLater(initiativeId, msg).catch(() => {});
    console.error(`[CR EMAIL] Attempt ${attempts} for ${initiativeId} failed, retrying in 5 min: ${msg}`);
    return 'retry';
  }
}

let sweeping = false;

/** One sweep: send everything that is due. Exported for tests. */
export async function sweepCrEmails() {
  if (sweeping) return [];
  sweeping = true;
  try {
    await store.ensureSchema(); // the queue table is created with the rest of the schema
    const outcomes = [];
    for (;;) {
      const batch = await claimDue();
      if (!batch.length) break;
      for (const row of batch) outcomes.push(await sendOne(row));
    }
    return outcomes;
  } finally {
    sweeping = false;
  }
}

let timer = null;

/** Starts the sweeper on this node (every node runs one; the DB keeps them apart). */
export function startCrEmailSweeper() {
  if (timer) return;
  timer = setInterval(() => {
    sweepCrEmails().catch((e) => console.error('[CR EMAIL] Sweep failed:', e.message));
  }, SWEEP_EVERY_MS);
  timer.unref?.();
}

export function stopCrEmailSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}
