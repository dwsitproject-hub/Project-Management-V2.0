import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const databaseUrl =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres123@localhost:5544/project_management_v2';

const pool = new Pool({ connectionString: databaseUrl });

/** Comma-separated TEXT column -> trimmed, non-empty array ([] when NULL). */
function splitIds(raw) {
  if (raw == null || raw === '') return [];
  return String(raw).split(',').map((v) => v.trim()).filter(Boolean);
}
let schemaReady = null; // promise of the one-time schema set-up in this process

// Lock id for the schema set-up, so two nodes starting together don't run the DDL at
// the same time (concurrent CREATE / ALTER ... IF NOT EXISTS can fail or deadlock).
const SCHEMA_LOCK_ID = 727274001;

/** Creates / upgrades the tables once per process; retried on the next call if it failed. */
function initializeSchema() {
  if (!schemaReady) {
    schemaReady = runSchemaSetup().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function runSchemaSetup() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_ID]);
    const ddl = `
      CREATE TABLE IF NOT EXISTS "departments" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "email" TEXT,
        "role" TEXT,
        "type" TEXT,
        "departmentId" TEXT,
        "active" BOOLEAN DEFAULT TRUE,
        "passwordHash" TEXT,
        "isAdmin" BOOLEAN DEFAULT FALSE,
        "emailActivated" BOOLEAN DEFAULT FALSE,
        "activationToken" TEXT,
        "activationTokenExpiry" TEXT,
        "resetToken" TEXT,
        "resetTokenExpiry" TEXT,
        "teamMemberIds" TEXT
      );
      -- Ensure missing user columns/constraints exist (or are relaxed) for compatibility
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_key";
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active" BOOLEAN DEFAULT TRUE;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN DEFAULT FALSE;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailActivated" BOOLEAN DEFAULT FALSE;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activationToken" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activationTokenExpiry" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hubUserId" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "type" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "teamMemberIds" TEXT;
      CREATE TABLE IF NOT EXISTS "initiatives" (
        "id" TEXT PRIMARY KEY,
        "type" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "ticket" TEXT,
        "description" TEXT,
        "businessImpact" TEXT,
        "priority" TEXT,
        "businessOwnerId" TEXT,
        "businessUserIds" TEXT,
        "departmentId" TEXT,
        "itPicId" TEXT,
        "itPicIds" TEXT,
        "itPmId" TEXT,
        "itManagerIds" TEXT,
        "systemImpactedIds" TEXT,
        "status" TEXT,
        "milestone" TEXT,
        "crMilestonePhase" TEXT,
        "startDate" TEXT,
        "endDate" TEXT,
        "planStartDate" TEXT,
        "planEndDate" TEXT,
        "remark" TEXT,
        "documentationLink" TEXT,
        "createdAt" TEXT,
        "updatedAt" TEXT
      );
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "ticket" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "businessImpact" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "priority" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "businessOwnerId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "businessUserIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itPicId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itPicIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itPmId" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "itManagerIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "systemImpactedIds" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "milestone" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "crMilestonePhase" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "startDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "endDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "planStartDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "planEndDate" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "remark" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "documentationLink" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      -- Identifiers of the matching record(s) in an external system (e.g. ERP CR Ticket
      -- Number), comma-separated like the other *Ids columns.
      ALTER TABLE "initiatives" ADD COLUMN IF NOT EXISTS "externalIds" TEXT;
      CREATE TABLE IF NOT EXISTS "changeRequests" (
        "initiativeId" TEXT PRIMARY KEY,
        "crSubmissionStart" TEXT,
        "crSubmissionEnd" TEXT,
        "developmentStart" TEXT,
        "developmentEnd" TEXT,
        "sitStart" TEXT,
        "sitEnd" TEXT,
        "uatStart" TEXT,
        "uatEnd" TEXT,
        "liveDate" TEXT,
        "crSection1Start" TEXT,
        "crSection1End" TEXT,
        "crSection2Start" TEXT,
        "crSection2End" TEXT,
        "crSection3Start" TEXT,
        "crSection3End" TEXT,
        "liveStart" TEXT,
        "liveEnd" TEXT
      );
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSubmissionStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSubmissionEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "developmentStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "developmentEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "sitStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "sitEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "uatStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "uatEnd" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "liveDate" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection1Start" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection1End" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection2Start" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection2End" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection3Start" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "crSection3End" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "liveStart" TEXT;
      ALTER TABLE "changeRequests" ADD COLUMN IF NOT EXISTS "liveEnd" TEXT;
      CREATE TABLE IF NOT EXISTS "tags" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL
      );
      ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "name" TEXT;
      CREATE TABLE IF NOT EXISTS "initiativeTags" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "tagId" TEXT NOT NULL
      );
      ALTER TABLE "initiativeTags" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "initiativeTags" ADD COLUMN IF NOT EXISTS "tagId" TEXT;
      CREATE TABLE IF NOT EXISTS "statusHistory" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "changedAt" TEXT NOT NULL,
        "changedBy" TEXT
      );
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;
      ALTER TABLE "statusHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      CREATE TABLE IF NOT EXISTS "milestoneHistory" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "milestone" TEXT NOT NULL,
        "changedAt" TEXT NOT NULL,
        "changedBy" TEXT
      );
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "milestone" TEXT;
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;
      ALTER TABLE "milestoneHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      CREATE TABLE IF NOT EXISTS "changeHistory" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "timestamp" TEXT NOT NULL,
        "changedBy" TEXT
      );
      ALTER TABLE "changeHistory" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "changeHistory" ADD COLUMN IF NOT EXISTS "timestamp" TEXT;
      ALTER TABLE "changeHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      CREATE TABLE IF NOT EXISTS "changeHistoryItem" (
        "id" TEXT PRIMARY KEY,
        "changeHistoryId" TEXT NOT NULL,
        "field" TEXT NOT NULL,
        "oldValue" TEXT,
        "newValue" TEXT,
        "changedAt" TEXT NOT NULL
      );
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "changeHistoryId" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "field" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "oldValue" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "newValue" TEXT;
      ALTER TABLE "changeHistoryItem" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "comments" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "authorId" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT
      );
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "authorId" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "body" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "tasks" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "startDate" TEXT,
        "endDate" TEXT,
        "assigneeId" TEXT,
        "status" TEXT,
        "milestone" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT
      );
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "name" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "description" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "startDate" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "endDate" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigneeId" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "milestone" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "documents" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "filePath" TEXT NOT NULL,
        "sizeBytes" INTEGER NOT NULL,
        "uploadedBy" TEXT NOT NULL,
        "uploadedAt" TEXT NOT NULL
      );
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "filePath" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "uploadedBy" TEXT;
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "uploadedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "initiativeId" TEXT,
        "commentId" TEXT,
        "read" BOOLEAN DEFAULT FALSE,
        "createdAt" TEXT NOT NULL
      );
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "userId" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "message" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "commentId" TEXT;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read" BOOLEAN DEFAULT FALSE;
      ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      CREATE TABLE IF NOT EXISTS "accessRules" (
        "id" TEXT PRIMARY KEY,
        "role" TEXT,
        "type" TEXT,
        "emailDomain" TEXT,
        "canViewProjectDashboard" BOOLEAN,
        "canViewProjectList" BOOLEAN,
        "canCreateProject" BOOLEAN,
        "canEditAnyProject" BOOLEAN,
        "restrictProjectVisibilityToOwnTeamOnly" BOOLEAN,
        "restrictProjectEditToOwnTeamOnly" BOOLEAN,
        "canViewCRDashboard" BOOLEAN,
        "canViewCRList" BOOLEAN,
        "canCreateCR" BOOLEAN,
        "canEditCR" BOOLEAN,
        "canViewMasterDwsApplication" BOOLEAN,
        "canViewManagementDashboard" BOOLEAN
      );
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "role" TEXT;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "type" TEXT;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "emailDomain" TEXT;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewProjectDashboard" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewProjectList" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canCreateProject" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canEditAnyProject" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "restrictProjectVisibilityToOwnTeamOnly" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "restrictProjectEditToOwnTeamOnly" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewCRDashboard" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewCRList" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canCreateCR" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canEditCR" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewMasterDwsApplication" BOOLEAN;
      ALTER TABLE "accessRules" ADD COLUMN IF NOT EXISTS "canViewManagementDashboard" BOOLEAN;

      CREATE TABLE IF NOT EXISTS "apiClients" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "clientId" TEXT NOT NULL,
        "clientSecretHash" TEXT NOT NULL,
        "scopes" TEXT,
        "active" BOOLEAN DEFAULT TRUE,
        "createdAt" TEXT NOT NULL
      );
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "name" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "clientSecretHash" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "scopes" TEXT;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "active" BOOLEAN DEFAULT TRUE;
      ALTER TABLE "apiClients" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;

      CREATE TABLE IF NOT EXISTS "dwsApplications" (
        "id" TEXT PRIMARY KEY,
        "systemName" TEXT NOT NULL,
        "productionUrl" TEXT,
        "stagingUrl" TEXT,
        "githubUrl" TEXT,
        "deploymentSteps" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      );
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "systemName" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "productionUrl" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "stagingUrl" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "githubUrl" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "deploymentSteps" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      -- External system codes that map to this application (e.g. ERP SAP module codes
      -- "FI,CO" for SAP FICO), comma-separated.
      ALTER TABLE "dwsApplications" ADD COLUMN IF NOT EXISTS "externalIds" TEXT;

      CREATE TABLE IF NOT EXISTS "managementDashboard" (
        "id" TEXT PRIMARY KEY,
        "portfolioStatus" TEXT,
        "highlights" TEXT,
        "criticalAlerts" TEXT,
        "updatedBy" TEXT,
        "updatedAt" TEXT NOT NULL
      );
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "portfolioStatus" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "highlights" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "criticalAlerts" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
      ALTER TABLE "managementDashboard" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      CREATE TABLE IF NOT EXISTS "meetingNotes" (
        "id" TEXT PRIMARY KEY,
        "initiativeId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "meetingType" TEXT NOT NULL,
        "meetingDate" TEXT NOT NULL,
        "location" TEXT,
        "meetingLink" TEXT,
        "facilitatorId" TEXT NOT NULL,
        "noteTakerId" TEXT NOT NULL,
        "agenda" TEXT,
        "discussion" TEXT,
        "decisions" TEXT,
        "risks" TEXT,
        "nextMeetingAt" TEXT,
        "status" TEXT NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "createdBy" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL,
        "deletedAt" TEXT
      );
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "deletedAt" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "initiativeId" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "title" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "meetingType" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "meetingDate" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "location" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "meetingLink" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "facilitatorId" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "noteTakerId" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "agenda" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "discussion" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "decisions" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "risks" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "nextMeetingAt" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "createdAt" TEXT;
      ALTER TABLE "meetingNotes" ADD COLUMN IF NOT EXISTS "updatedAt" TEXT;
      UPDATE "meetingNotes" SET "status" = 'Published' WHERE "status" IN ('Sent', 'Archived');
      CREATE TABLE IF NOT EXISTS "meetingNoteParticipants" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "userId" TEXT,
        "email" TEXT,
        "name" TEXT,
        "role" TEXT NOT NULL
      );
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "userId" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "email" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "name" TEXT;
      ALTER TABLE "meetingNoteParticipants" ADD COLUMN IF NOT EXISTS "role" TEXT;
      CREATE TABLE IF NOT EXISTS "meetingNoteActionItems" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "ownerId" TEXT,
        "ownerName" TEXT,
        "dueDate" TEXT,
        "priority" TEXT,
        "status" TEXT NOT NULL,
        "orderIndex" INTEGER NOT NULL DEFAULT 0
      );
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "description" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "ownerName" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "dueDate" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "priority" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "status" TEXT;
      ALTER TABLE "meetingNoteActionItems" ADD COLUMN IF NOT EXISTS "orderIndex" INTEGER DEFAULT 0;
      CREATE TABLE IF NOT EXISTS "meetingNoteEmailLog" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "subject" TEXT NOT NULL,
        "toEmails" TEXT NOT NULL,
        "ccEmails" TEXT,
        "bodySnapshot" TEXT NOT NULL,
        "sentBy" TEXT NOT NULL,
        "sentAt" TEXT NOT NULL,
        "deliveryStatus" TEXT NOT NULL,
        "providerMessageId" TEXT,
        "errorMessage" TEXT
      );
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "subject" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "toEmails" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "ccEmails" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "bodySnapshot" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "sentBy" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "sentAt" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;
      ALTER TABLE "meetingNoteEmailLog" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
      CREATE TABLE IF NOT EXISTS "meetingNoteHistory" (
        "id" TEXT PRIMARY KEY,
        "meetingNoteId" TEXT NOT NULL,
        "version" INTEGER NOT NULL,
        "field" TEXT NOT NULL,
        "oldValue" TEXT,
        "newValue" TEXT,
        "changedBy" TEXT NOT NULL,
        "changedAt" TEXT NOT NULL
      );
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "meetingNoteId" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "version" INTEGER;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "field" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "oldValue" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "newValue" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "changedBy" TEXT;
      ALTER TABLE "meetingNoteHistory" ADD COLUMN IF NOT EXISTS "changedAt" TEXT;

      -- Bumped by every write() that changes something. Each node compares it with the
      -- version its cache was loaded at, so a save on one node is seen on all of them.
      CREATE TABLE IF NOT EXISTS "storeMeta" (
        "id" TEXT PRIMARY KEY,
        "version" BIGINT NOT NULL DEFAULT 0
      );
      INSERT INTO "storeMeta"("id", "version") VALUES ('store', 0) ON CONFLICT ("id") DO NOTHING;

      -- CR creation emails waiting to be sent (services/cr-email-queue.js). Not part of
      -- read()/write(): only the queue touches it.
      CREATE TABLE IF NOT EXISTS "crEmailQueue" (
        "initiativeId" TEXT PRIMARY KEY,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "dueAt" TIMESTAMPTZ NOT NULL,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "claimedAt" TIMESTAMPTZ,
        "sentAt" TIMESTAMPTZ,
        "lastError" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "crEmailQueue_due" ON "crEmailQueue" ("status", "dueAt");
    `;
    await client.query(ddl);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// ---- Read cache --------------------------------------------------------------
// Every request reads the whole store (the auth middleware AND the route each call
// read()). Against a remote DB (ApsaraDB RDS) a full read is ~23 queries plus ~1.4 MB
// over the wire, so each process keeps the last read in memory.
//
// Several backend nodes (HA) each have their own cache, so before answering from it we
// compare the "storeMeta" version (one tiny query; write() bumps it in the same
// transaction) with the version the cache was loaded at. A save on any node is
// therefore seen by the very next request on every node. A write in this process also
// drops its own cache straight away.
//
// The TTL only matters for changes that bypass write() (SQL typed by hand): an expired
// cache is still answered from, and refreshed in the background.
// Set STORE_READ_CACHE_TTL_MS=0 to disable the cache.
const READ_CACHE_TTL_MS = Number(process.env.STORE_READ_CACHE_TTL_MS ?? 30000);
let readCache = null; // { data, version, at }
let cacheGeneration = 0; // bumped on invalidate so an in-flight read can't cache stale data
let inflightRead = null; // coalesces concurrent cache misses into a single DB read
let inflightVersion = null; // coalesces concurrent version checks

/** The current store version in the DB (concurrent callers share one query). */
function currentVersion() {
  if (!inflightVersion) {
    const p = (async () => {
      await initializeSchema();
      const res = await pool.query('SELECT "version" FROM "storeMeta" WHERE "id" = $1', ['store']);
      return Number(res.rows[0]?.version ?? 0);
    })().finally(() => {
      if (inflightVersion === p) inflightVersion = null;
    });
    inflightVersion = p;
  }
  return inflightVersion;
}

async function loadShared() {
  if (READ_CACHE_TTL_MS <= 0) return (await readFromDb()).data;
  const cached = readCache;
  if (!cached) return (await startDbRead()).data;

  let version;
  try {
    version = await currentVersion();
  } catch (e) {
    // DB unreachable: keep answering reads from memory (writes will fail anyway).
    console.error('[STORE] Version check failed, serving cached data:', e.message);
    return cached.data;
  }
  if (version === cached.version) {
    if (Date.now() - cached.at >= READ_CACHE_TTL_MS) {
      startDbRead().catch((e) => console.error('[STORE] Background refresh failed:', e.message));
    }
    return cached.data;
  }
  // Another node (or a script) saved since this cache was loaded: reload. A read that
  // was already running may have started before that save, so check what it got.
  let entry = await startDbRead();
  if (entry.version < version) entry = await startDbRead({ fresh: true });
  return entry.data;
}

function startDbRead({ fresh = false } = {}) {
  if (!inflightRead || fresh) {
    const gen = cacheGeneration;
    const p = readFromDb()
      .then((entry) => {
        const newer = !readCache || entry.version >= readCache.version;
        if (gen === cacheGeneration && READ_CACHE_TTL_MS > 0 && newer) readCache = entry;
        return entry;
      })
      .finally(() => {
        if (inflightRead === p) inflightRead = null;
      });
    inflightRead = p;
  }
  return inflightRead;
}

function invalidateReadCache() {
  cacheGeneration += 1;
  readCache = null;
  inflightRead = null; // requests arriving after a write must not join a pre-write read
}

const cloneOrigin = new WeakMap(); // read() copy -> the shared snapshot it was copied from
const LAZY_TABLE = Symbol('lazyTable');

/**
 * Returns a private deep copy — callers may mutate it and pass it to write().
 *
 * Each table is copied the first time it is touched (most requests use 2–3 of the
 * ~22 tables, and copying everything cost ~60 ms per request). Assigning a table
 * replaces it as usual. write() skips tables that were never touched.
 */
async function read() {
  const shared = await loadShared();
  const copy = {};
  for (const key of Object.keys(shared)) {
    const set = (value) => Object.defineProperty(copy, key, { value, writable: true, enumerable: true, configurable: true });
    const get = () => {
      const value = structuredClone(shared[key]);
      set(value);
      return value;
    };
    get[LAZY_TABLE] = true;
    Object.defineProperty(copy, key, { get, set, enumerable: true, configurable: true });
  }
  cloneOrigin.set(copy, shared);
  return copy;
}

/** True while a read() copy's table has never been read or assigned. */
function isUntouched(data, table) {
  const desc = Object.getOwnPropertyDescriptor(data, table);
  return !!(desc && desc.get && desc.get[LAZY_TABLE]);
}

/**
 * Returns the SHARED cached object without copying. Read-only contract: the caller
 * must never mutate it (or anything reachable from it). Use only on hot, pure-read
 * paths such as the auth middleware.
 */
async function readShared() {
  return loadShared();
}

async function readFromDb() {
  await initializeSchema();
  // Read the version BEFORE the tables: the data is then at least that new, so a save
  // landing mid-read only causes one extra reload later, never a stale cache.
  const versionRes = await pool.query('SELECT "version" FROM "storeMeta" WHERE "id" = $1', ['store']);
  const version = Number(versionRes.rows[0]?.version ?? 0);
  const data = {};
  const tables = [
    'departments',
    'users',
    'initiatives',
    'changeRequests',
    'tags',
    'initiativeTags',
    'statusHistory',
    'milestoneHistory',
    'comments',
    'tasks',
    'documents',
    'notifications',
    'accessRules',
    'apiClients',
    'dwsApplications',
    'managementDashboard',
    'meetingNotes',
    'meetingNoteParticipants',
    'meetingNoteActionItems',
    'meetingNoteEmailLog',
    'meetingNoteHistory',
  ];
  // Query all tables at once (each on its own pooled connection): against a remote DB
  // the ~23 sequential round-trips were most of a cold read.
  const [historyRes, itemsRes, ...tableResults] = await Promise.all(
    ['changeHistory', 'changeHistoryItem', ...tables].map((t) => pool.query(`SELECT * FROM "${t}"`)),
  );
  for (const [index, table] of tables.entries()) {
    const res = tableResults[index];
    // Transform PostgreSQL column names to camelCase for users table
    // Note: PostgreSQL preserves case for quoted identifiers, so "isAdmin" returns as isAdmin
    if (table === 'users') {
      data[table] = res.rows.map(row => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        departmentId: row.departmentId || row.departmentid,
        active: row.active,
        passwordHash: row.passwordHash || row.passwordhash,
        isAdmin: !!(row.isAdmin !== undefined ? row.isAdmin : row.isadmin), // Handle both cases
        emailActivated: row.emailActivated !== undefined ? row.emailActivated : (row.emailactivated !== undefined ? row.emailactivated : false),
        activationToken: row.activationToken || row.activationtoken || null,
        activationTokenExpiry: row.activationTokenExpiry || row.activationtokenexpiry || null,
        resetToken: row.resetToken || row.resettoken || null,
        resetTokenExpiry: row.resetTokenExpiry || row.resettokenexpiry || null,
        type: row.type || null,
        teamMemberIds: row.teamMemberIds || row.teammemberids ? (row.teamMemberIds || row.teammemberids).split(',').filter(Boolean) : [],
        createdAt: row.createdAt || row.createdat || null,
        hubUserId: row.hubUserId || row.hubuserid || null,
      }));
    } else if (table === 'initiatives') {
      // Transform initiatives and parse comma-separated arrays
      data[table] = res.rows.map(row => ({
        id: row.id,
        type: row.type,
        name: row.name,
        ticket: row.ticket || null,
        description: row.description || null,
        businessImpact: row.businessImpact || row.businessimpact || null,
        priority: row.priority || null,
        businessOwnerId: row.businessOwnerId || row.businessownerid || null,
        businessUserIds: row.businessUserIds || row.businessuserids ? (row.businessUserIds || row.businessuserids).split(',').filter(Boolean) : [],
        departmentId: row.departmentId || row.departmentid || null,
        itPicId: row.itPicId || row.itpicid || null, // Keep for backward compatibility
        itPicIds: row.itPicIds || row.itpicids ? (row.itPicIds || row.itpicids).split(',').filter(Boolean) : (row.itPicId || row.itpicid ? [row.itPicId || row.itpicid] : []),
        itPmId: row.itPmId || row.itpmid || null,
        itManagerIds: row.itManagerIds || row.itmanagerids ? (row.itManagerIds || row.itmanagerids).split(',').filter(Boolean) : [],
        systemImpactedIds: row.systemImpactedIds || row.systemimpactedids ? (row.systemImpactedIds || row.systemimpactedids).split(',').filter(Boolean) : [],
        status: row.status || null,
        milestone: row.milestone || null,
        crMilestonePhase: row.crMilestonePhase || row.crmilestonephase || null,
        startDate: row.startDate || row.startdate || null,
        endDate: row.endDate || row.enddate || null,
        planStartDate: row.planStartDate || row.planstartdate || null,
        planEndDate: row.planEndDate || row.planenddate || null,
        remark: row.remark || null,
        documentationLink: row.documentationLink || row.documentationlink || null,
        externalIds: splitIds(row.externalIds ?? row.externalids),
        createdAt: row.createdAt || row.createdat || null,
        updatedAt: row.updatedAt || row.updatedat || null
      }));
      // itPicId is the legacy single IT PIC. Edits only update the itPicIds list, so it
      // could still name someone who is no longer IT PIC (e.g. a replaced "New Hire"),
      // and every reader of itPicId (filters, dashboards, CR task assignee, the
      // calendar) saw the wrong person. Keep it equal to a member of the list.
      for (const i of data[table]) {
        if (i.itPicIds.length && !i.itPicIds.includes(i.itPicId)) i.itPicId = i.itPicIds[0];
      }
    } else if (table === 'notifications') {
      // Transform notifications
      data[table] = res.rows.map(row => ({
        id: row.id,
        userId: row.userId || row.userid,
        type: row.type,
        title: row.title,
        message: row.message,
        initiativeId: row.initiativeId || row.initiativeid || null,
        commentId: row.commentId || row.commentid || null,
        read: row.read !== undefined ? !!row.read : false,
        createdAt: row.createdAt || row.createdat
      }));
    } else if (table === 'accessRules') {
      data[table] = res.rows;
    } else if (table === 'apiClients') {
      data[table] = res.rows.map((row) => ({
        id: row.id,
        name: row.name,
        clientId: row.clientId || row.clientid,
        clientSecretHash: row.clientSecretHash || row.clientsecrethash,
        scopes: row.scopes || null,
        active: row.active !== undefined ? !!row.active : true,
        createdAt: row.createdAt || row.createdat,
      }));
    } else if (table === 'dwsApplications') {
      data[table] = res.rows.map((row) => ({
        id: row.id,
        systemName: row.systemName || row.systemname,
        productionUrl: row.productionUrl || row.productionurl || null,
        stagingUrl: row.stagingUrl || row.stagingurl || null,
        githubUrl: row.githubUrl || row.githuburl || null,
        deploymentSteps: row.deploymentSteps || row.deploymentsteps || null,
        externalIds: splitIds(row.externalIds ?? row.externalids),
        createdAt: row.createdAt || row.createdat,
        updatedAt: row.updatedAt || row.updatedat,
      }));
    } else if (table === 'managementDashboard') {
      data[table] = res.rows.map((row) => ({
        id: row.id,
        portfolioStatus: row.portfolioStatus || row.portfoliostatus || null,
        highlights: row.highlights || null,
        criticalAlerts: row.criticalAlerts || row.criticalalerts || null,
        updatedBy: row.updatedBy || row.updatedby || null,
        updatedAt: row.updatedAt || row.updatedat,
      }));
    } else if (table === 'meetingNotes') {
      data[table] = res.rows.map(row => ({
        id: row.id,
        initiativeId: row.initiativeId || row.initiativeid,
        title: row.title,
        meetingType: row.meetingType || row.meetingtype,
        meetingDate: row.meetingDate || row.meetingdate,
        location: row.location || null,
        meetingLink: row.meetingLink || row.meetinglink || null,
        facilitatorId: row.facilitatorId || row.facilitatorid,
        noteTakerId: row.noteTakerId || row.notetakerid,
        agenda: row.agenda || null,
        discussion: row.discussion || null,
        decisions: row.decisions || null,
        risks: row.risks || null,
        nextMeetingAt: row.nextMeetingAt || row.nextmeetingat || null,
        status: row.status,
        version: row.version ? Number(row.version) : 1,
        createdBy: row.createdBy || row.createdby,
        createdAt: row.createdAt || row.createdat,
        updatedAt: row.updatedAt || row.updatedat,
        deletedAt: row.deletedAt || row.deletedat || null,
      }));
    } else if (table === 'meetingNoteParticipants') {
      data[table] = res.rows.map(row => ({
        id: row.id,
        meetingNoteId: row.meetingNoteId || row.meetingnoteid,
        userId: row.userId || row.userid || null,
        email: row.email || null,
        name: row.name || null,
        role: row.role || null,
      }));
    } else if (table === 'meetingNoteActionItems') {
      data[table] = res.rows.map(row => ({
        id: row.id,
        meetingNoteId: row.meetingNoteId || row.meetingnoteid,
        description: row.description,
        ownerId: row.ownerId || row.ownerid || null,
        ownerName: row.ownerName || row.ownername || null,
        dueDate: row.dueDate || row.duedate || null,
        priority: row.priority || null,
        status: row.status,
        orderIndex: row.orderIndex !== undefined ? Number(row.orderIndex) : Number(row.orderindex || 0),
      }));
    } else if (table === 'meetingNoteEmailLog') {
      data[table] = res.rows.map(row => ({
        id: row.id,
        meetingNoteId: row.meetingNoteId || row.meetingnoteid,
        subject: row.subject,
        toEmails: row.toEmails || row.toemails || null,
        ccEmails: row.ccEmails || row.ccemails || null,
        bodySnapshot: row.bodySnapshot || row.bodysnapshot || null,
        sentBy: row.sentBy || row.sentby || null,
        sentAt: row.sentAt || row.sentat || null,
        deliveryStatus: row.deliveryStatus || row.deliverystatus || null,
        providerMessageId: row.providerMessageId || row.providermessageid || null,
        errorMessage: row.errorMessage || row.errormessage || null,
      }));
    } else if (table === 'meetingNoteHistory') {
      data[table] = res.rows.map(row => ({
        id: row.id,
        meetingNoteId: row.meetingNoteId || row.meetingnoteid,
        version: row.version !== undefined ? Number(row.version) : 1,
        field: row.field,
        oldValue: row.oldValue ?? row.oldvalue ?? null,
        newValue: row.newValue ?? row.newvalue ?? null,
        changedBy: row.changedBy || row.changedby || null,
        changedAt: row.changedAt || row.changedat || null,
      }));
    } else {
      data[table] = res.rows;
    }
  }

  // Normalize column names from Postgres (quoted camelCase columns are returned with exact case)
  const itemsByChangeId = itemsRes.rows.reduce((acc, row) => {
    const changeHistoryId = row.changeHistoryId || row.changehistoryid;
    if (!changeHistoryId) return acc;
    if (!acc[changeHistoryId]) acc[changeHistoryId] = [];
    acc[changeHistoryId].push({
      field: row.field,
      oldValue: row.oldValue ?? row.oldvalue,
      newValue: row.newValue ?? row.newvalue,
      changedAt: row.changedAt ?? row.changedat,
    });
    return acc;
  }, {});

  data.changeHistory = historyRes.rows
    .map((h) => ({
      id: h.id,
      initiativeId: h.initiativeId ?? h.initiativeid,
      timestamp: h.timestamp,
      changedBy: h.changedBy ?? h.changedby,
      changes: itemsByChangeId[h.id] || [],
    }))
    // Filter out entries without initiativeId to avoid breaking lookups
    .filter((h) => !!h.initiativeId);

  return { data, version, at: Date.now() };
}

/** Serialize writes (one transaction at a time) to avoid races (502 / duplicate key). */
let writeQueue = Promise.resolve();

async function write(data) {
  const run = writeQueue.then(async () => {
    try {
      await writeImpl(data);
    } finally {
      // Drop the cache (don't seed it from `data`): the next read reloads exactly what
      // was persisted, including column coercions and dropped non-column fields.
      invalidateReadCache();
      // ...and start that reload now, so the request that follows a save (the page the
      // user lands on) doesn't wait for it. Later reads join this in-flight read.
      loadShared().catch((e) => console.error('[STORE] Reload after write failed:', e.message));
    }
  });
  writeQueue = run.catch(() => {});
  return run;
}

// ---- Write -------------------------------------------------------------------
// One spec per table: its key column, the columns write() owns, and how to turn
// `data[source]` into one parameter array per row (same coercions as before).
const arr = (v) => (Array.isArray(v) ? v.join(',') : (v || null));
const TABLE_SPECS = [
  { table: 'departments', cols: ['id', 'name'], row: (d) => [d.id, d.name] },
  {
    table: 'users',
    cols: ['id', 'name', 'email', 'role', 'type', 'departmentId', 'active', 'passwordHash', 'isAdmin', 'emailActivated', 'activationToken', 'activationTokenExpiry', 'resetToken', 'resetTokenExpiry', 'teamMemberIds', 'hubUserId'],
    row: (u) => [
      u.id, u.name, u.email, u.role, u.type || null, u.departmentId, !!u.active, u.passwordHash || null, !!u.isAdmin,
      u.emailActivated !== undefined ? !!u.emailActivated : false,
      u.activationToken || null, u.activationTokenExpiry || null, u.resetToken || null, u.resetTokenExpiry || null,
      arr(u.teamMemberIds),
      u.hubUserId || null, // Downstream Hub user UUID (OIDC sub), set at SSO sign-in
    ],
  },
  {
    table: 'initiatives',
    cols: ['id', 'type', 'name', 'ticket', 'description', 'businessImpact', 'priority', 'businessOwnerId', 'businessUserIds', 'departmentId', 'itPicId', 'itPicIds', 'itPmId', 'itManagerIds', 'systemImpactedIds', 'status', 'milestone', 'crMilestonePhase', 'startDate', 'endDate', 'planStartDate', 'planEndDate', 'remark', 'documentationLink', 'externalIds', 'createdAt', 'updatedAt'],
    row: (i) => [
      i.id, i.type, i.name, i.ticket || null, i.description || null, i.businessImpact || null, i.priority || null,
      i.businessOwnerId || null, arr(i.businessUserIds), i.departmentId || null,
      i.itPicId || null, // legacy single IT PIC, kept for backward compatibility
      arr(i.itPicIds), i.itPmId || null, arr(i.itManagerIds), arr(i.systemImpactedIds),
      i.status || null, i.milestone || null, i.crMilestonePhase || null, i.startDate || null, i.endDate || null,
      i.planStartDate || null, i.planEndDate || null, i.remark || null, i.documentationLink || null,
      arr(i.externalIds), i.createdAt || null, i.updatedAt || null,
    ],
  },
  {
    table: 'changeRequests',
    key: 'initiativeId',
    cols: ['initiativeId', 'crSubmissionStart', 'crSubmissionEnd', 'developmentStart', 'developmentEnd', 'sitStart', 'sitEnd', 'uatStart', 'uatEnd', 'liveDate', 'crSection1Start', 'crSection1End', 'crSection2Start', 'crSection2End', 'crSection3Start', 'crSection3End', 'liveStart', 'liveEnd'],
    row: (cr) => [cr.initiativeId, ...['crSubmissionStart', 'crSubmissionEnd', 'developmentStart', 'developmentEnd', 'sitStart', 'sitEnd', 'uatStart', 'uatEnd', 'liveDate', 'crSection1Start', 'crSection1End', 'crSection2Start', 'crSection2End', 'crSection3Start', 'crSection3End', 'liveStart', 'liveEnd'].map((k) => cr[k] || null)],
  },
  { table: 'tags', cols: ['id', 'name'], row: (t) => [t.id, t.name] },
  { table: 'initiativeTags', cols: ['id', 'initiativeId', 'tagId'], row: (t) => [t.id, t.initiativeId, t.tagId] },
  { table: 'statusHistory', cols: ['id', 'initiativeId', 'status', 'changedAt', 'changedBy'], row: (s) => [s.id, s.initiativeId, s.status, s.changedAt, s.changedBy || null] },
  { table: 'milestoneHistory', cols: ['id', 'initiativeId', 'milestone', 'changedAt', 'changedBy'], row: (m) => [m.id, m.initiativeId, m.milestone, m.changedAt, m.changedBy || null] },
  {
    // Items live in "changeHistoryItem" (see CHANGE_ITEM_COLS); they are written with their parent.
    table: 'changeHistory',
    cols: ['id', 'initiativeId', 'timestamp', 'changedBy'],
    skip: (ch) => !ch.initiativeId, // entries without an initiative would break lookups
    row: (ch) => [ch.id, ch.initiativeId, ch.timestamp, ch.changedBy || null],
    children: (ch) => (ch.changes || []).map((item) => [
      item.id || `${ch.id}:${item.field}:${item.changedAt}`, ch.id, item.field, item.oldValue || null, item.newValue || null, item.changedAt,
    ]),
  },
  { table: 'comments', cols: ['id', 'initiativeId', 'authorId', 'body', 'createdAt', 'updatedAt'], row: (c) => [c.id, c.initiativeId, c.authorId, c.body, c.createdAt, c.updatedAt || null] },
  {
    table: 'tasks',
    cols: ['id', 'initiativeId', 'name', 'description', 'startDate', 'endDate', 'assigneeId', 'status', 'milestone', 'createdAt', 'updatedAt'],
    row: (t) => [t.id, t.initiativeId, t.name, t.description || null, t.startDate || null, t.endDate || null, t.assigneeId || null, t.status || null, t.milestone || null, t.createdAt, t.updatedAt || null],
  },
  {
    table: 'documents',
    cols: ['id', 'initiativeId', 'fileName', 'filePath', 'sizeBytes', 'uploadedBy', 'uploadedAt'],
    row: (d) => [d.id, d.initiativeId, d.fileName, d.filePath, d.sizeBytes, d.uploadedBy, d.uploadedAt],
  },
  {
    table: 'notifications',
    cols: ['id', 'userId', 'type', 'title', 'message', 'initiativeId', 'commentId', 'read', 'createdAt'],
    row: (n) => [n.id, n.userId, n.type, n.title, n.message, n.initiativeId || null, n.commentId || null, !!n.read, n.createdAt],
  },
  {
    table: 'apiClients',
    cols: ['id', 'name', 'clientId', 'clientSecretHash', 'scopes', 'active', 'createdAt'],
    row: (c) => [c.id, c.name, c.clientId, c.clientSecretHash, c.scopes || null, c.active !== undefined ? !!c.active : true, c.createdAt],
  },
  {
    table: 'dwsApplications',
    cols: ['id', 'systemName', 'productionUrl', 'stagingUrl', 'githubUrl', 'deploymentSteps', 'externalIds', 'createdAt', 'updatedAt'],
    row: (a) => [a.id, a.systemName, a.productionUrl || null, a.stagingUrl || null, a.githubUrl || null, a.deploymentSteps || null, arr(a.externalIds), a.createdAt, a.updatedAt],
  },
  {
    table: 'accessRules',
    cols: ['id', 'role', 'type', 'emailDomain', 'canViewProjectDashboard', 'canViewProjectList', 'canCreateProject', 'canEditAnyProject', 'restrictProjectVisibilityToOwnTeamOnly', 'restrictProjectEditToOwnTeamOnly', 'canViewCRDashboard', 'canViewCRList', 'canCreateCR', 'canEditCR', 'canViewMasterDwsApplication', 'canViewManagementDashboard'],
    row: (r) => [
      r.id, r.role || null, r.type || null, r.emailDomain || null,
      ...['canViewProjectDashboard', 'canViewProjectList', 'canCreateProject', 'canEditAnyProject', 'restrictProjectVisibilityToOwnTeamOnly', 'restrictProjectEditToOwnTeamOnly', 'canViewCRDashboard', 'canViewCRList', 'canCreateCR', 'canEditCR', 'canViewMasterDwsApplication', 'canViewManagementDashboard'].map((k) => !!r[k]),
    ],
  },
  {
    table: 'managementDashboard',
    cols: ['id', 'portfolioStatus', 'highlights', 'criticalAlerts', 'updatedBy', 'updatedAt'],
    row: (d) => [d.id, d.portfolioStatus || null, d.highlights || null, d.criticalAlerts || null, d.updatedBy || null, d.updatedAt],
  },
  {
    table: 'meetingNotes',
    cols: ['id', 'initiativeId', 'title', 'meetingType', 'meetingDate', 'location', 'meetingLink', 'facilitatorId', 'noteTakerId', 'agenda', 'discussion', 'decisions', 'risks', 'nextMeetingAt', 'status', 'version', 'createdBy', 'createdAt', 'updatedAt', 'deletedAt'],
    row: (n) => [
      n.id, n.initiativeId, n.title, n.meetingType, n.meetingDate, n.location || null, n.meetingLink || null, n.facilitatorId, n.noteTakerId,
      n.agenda || null, n.discussion || null, n.decisions || null, n.risks || null, n.nextMeetingAt || null, n.status || 'Draft', n.version || 1,
      n.createdBy, n.createdAt, n.updatedAt || n.createdAt, n.deletedAt || null,
    ],
  },
  {
    table: 'meetingNoteParticipants',
    cols: ['id', 'meetingNoteId', 'userId', 'email', 'name', 'role'],
    row: (p) => [p.id, p.meetingNoteId, p.userId || null, p.email || null, p.name || null, p.role || 'Attendee'],
  },
  {
    table: 'meetingNoteActionItems',
    cols: ['id', 'meetingNoteId', 'description', 'ownerId', 'ownerName', 'dueDate', 'priority', 'status', 'orderIndex'],
    row: (a) => [a.id, a.meetingNoteId, a.description, a.ownerId || null, a.ownerName || null, a.dueDate || null, a.priority || null, a.status || 'Not Started', a.orderIndex || 0],
  },
  {
    table: 'meetingNoteEmailLog',
    cols: ['id', 'meetingNoteId', 'subject', 'toEmails', 'ccEmails', 'bodySnapshot', 'sentBy', 'sentAt', 'deliveryStatus', 'providerMessageId', 'errorMessage'],
    row: (l) => [l.id, l.meetingNoteId, l.subject, l.toEmails || '', l.ccEmails || null, l.bodySnapshot || '', l.sentBy, l.sentAt, l.deliveryStatus || 'Sent', l.providerMessageId || null, l.errorMessage || null],
  },
  {
    table: 'meetingNoteHistory',
    cols: ['id', 'meetingNoteId', 'version', 'field', 'oldValue', 'newValue', 'changedBy', 'changedAt'],
    row: (h) => [h.id, h.meetingNoteId, h.version || 1, h.field, h.oldValue || null, h.newValue || null, h.changedBy || 'Unknown', h.changedAt],
  },
];
const CHANGE_ITEM_COLS = ['id', 'changeHistoryId', 'field', 'oldValue', 'newValue', 'changedAt'];

/**
 * Rows of one table as Map(key -> { params, sig, children }). Duplicate keys keep the
 * first row (the old writer did that for departments / accessRules and failed on the
 * others); rows without a key are skipped.
 */
function tableRows(spec, list) {
  const keyIdx = spec.cols.indexOf(spec.key || 'id');
  const out = new Map();
  for (const item of list || []) {
    if (!item || (spec.skip && spec.skip(item))) continue;
    const params = spec.row(item);
    const key = params[keyIdx];
    if (key === null || key === undefined || key === '' || out.has(key)) continue;
    const children = spec.children ? spec.children(item) : null;
    out.set(key, { params, children, sig: JSON.stringify(children ? [params, children] : params) });
  }
  return out;
}

const quote = (c) => `"${c}"`;
const MAX_BIND_PARAMS = 30000; // Postgres allows 65535 bind parameters per statement

/** Multi-row INSERT ... ON CONFLICT DO UPDATE, chunked under the bind-parameter limit. */
async function upsertRows(client, table, cols, key, rows) {
  if (!rows.length) return;
  const perChunk = Math.max(1, Math.floor(MAX_BIND_PARAMS / cols.length));
  const updates = cols.filter((c) => c !== key).map((c) => `${quote(c)} = EXCLUDED.${quote(c)}`).join(', ');
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const values = [];
    const tuples = chunk.map((params, r) => {
      values.push(...params);
      return `(${params.map((_, c) => `$${r * cols.length + c + 1}`).join(',')})`;
    });
    await client.query(
      `INSERT INTO ${quote(table)}(${cols.map(quote).join(', ')}) VALUES ${tuples.join(',')} ` +
      `ON CONFLICT (${quote(key)}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`,
      values,
    );
  }
}

async function deleteKeys(client, table, column, keys) {
  if (keys.length) await client.query(`DELETE FROM ${quote(table)} WHERE ${quote(column)} = ANY($1)`, [keys]);
}

/** Dedupes child rows (changeHistoryItem) by id across all changed parents. */
function uniqueChildRows(entries) {
  const seen = new Set();
  const rows = [];
  for (const e of entries) {
    for (const params of e.children || []) {
      if (seen.has(params[0])) continue;
      seen.add(params[0]);
      rows.push(params);
    }
  }
  return rows;
}

/**
 * Writes `data` to the DB.
 *
 * When `data` came from read() we know the snapshot it was copied from, so we only
 * write what the caller actually changed: tables it never touched are skipped
 * entirely, and in touched tables only inserted / changed rows are upserted and
 * removed rows deleted. (Rewriting all ~9k rows took seconds per save.) It also means
 * two requests that read the same snapshot no longer undo each other's changes —
 * each one only writes its own rows.
 *
 * Any other object falls back to replacing every table with its contents.
 */
async function writeImpl(data) {
  await initializeSchema();
  const origin = cloneOrigin.get(data); // the shared snapshot `data` was copied from
  const started = Date.now();
  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    // Take the version row's lock first: saves from several nodes then run one at a
    // time (like the in-process writeQueue), so they can't deadlock on each other's rows.
    await client.query('SELECT "version" FROM "storeMeta" WHERE "id" = $1 FOR UPDATE', ['store']);
    for (const spec of TABLE_SPECS) {
      const key = spec.key || 'id';
      if (origin && isUntouched(data, spec.table)) continue;
      const next = tableRows(spec, data[spec.table]);

      if (!origin) {
        // Full replace.
        if (spec.children) await client.query('DELETE FROM "changeHistoryItem"');
        await client.query(`DELETE FROM ${quote(spec.table)}`);
        const entries = [...next.values()];
        await upsertRows(client, spec.table, spec.cols, key, entries.map((e) => e.params));
        if (spec.children) await upsertRows(client, 'changeHistoryItem', CHANGE_ITEM_COLS, 'id', uniqueChildRows(entries));
        written += entries.length;
        continue;
      }

      const prev = originRows(origin, spec);
      const changed = [];
      for (const [k, e] of next) {
        const before = prev.get(k);
        if (!before || before.sig !== e.sig) changed.push(e);
      }
      const removed = [];
      for (const k of prev.keys()) if (!next.has(k)) removed.push(k);
      if (!changed.length && !removed.length) continue;

      if (spec.children) {
        // Replace the items of every changed / removed parent (item ids are derived, so
        // match them by parent instead of by id).
        await deleteKeys(client, 'changeHistoryItem', 'changeHistoryId', [...removed, ...changed.map((e) => e.params[0])]);
      }
      await deleteKeys(client, spec.table, key, removed);
      await upsertRows(client, spec.table, spec.cols, key, changed.map((e) => e.params));
      if (spec.children) await upsertRows(client, 'changeHistoryItem', CHANGE_ITEM_COLS, 'id', uniqueChildRows(changed));
      written += changed.length + removed.length;
    }
    // Tell every node's cache that the data changed (only when something did).
    if (written > 0 || !origin) {
      await client.query('UPDATE "storeMeta" SET "version" = "version" + 1 WHERE "id" = $1', ['store']);
    }
    await client.query('COMMIT');
    console.log(`[STORE] Write completed (${origin ? 'changes only' : 'full'}) - ${written} rows in ${Date.now() - started}ms`);
  } catch (e) {
    console.error(`[STORE] Write error:`, e.message);
    console.error(`[STORE] Error stack:`, e.stack);
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Row maps of a shared snapshot, computed once per snapshot and table. */
const originRowCache = new WeakMap(); // snapshot -> Map(table -> rows)
function originRows(origin, spec) {
  let perTable = originRowCache.get(origin);
  if (!perTable) originRowCache.set(origin, (perTable = new Map()));
  if (!perTable.has(spec.table)) perTable.set(spec.table, tableRows(spec, origin[spec.table]));
  return perTable.get(spec.table);
}

export default { read, readShared, write, invalidateReadCache, ensureSchema: initializeSchema, pool, databaseUrl };

