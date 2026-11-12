// ERP CR sync API: ERP CR Management pushes its CRs into PM.
// Contract: docs/ERP-CR-SYNC-API.md (for the ERP team). Design: docs/ERP-CR-INTEGRATION-DESIGN.md.
//
//   PUT   /api/v1/integrations/erp/crs/:ticketNumber            create or update, full CR state
//   PATCH /api/v1/integrations/erp/crs/:ticketNumber            update some fields of an existing CR
//   GET   /api/v1/integrations/erp/crs/:ticketNumber            PM's view of a CR
//   PUT   /api/v1/integrations/erp/crs                          batch of full states (max 200)
//   PUT   /api/v1/integrations/erp/crs/:ticketNumber/document   the ERP CR document (one file, max 30 MB)
//   PUT   /api/v1/integrations/erp/modules                      ERP module master (add / rename / deactivate)
//
// Access: API clients with scope `cr:sync`; PM admins (for testing). The CR is found by
// its ERP Ticket Number in initiatives.externalIds. ERP sends ERP values (statuses,
// segment/stage, High/Medium/Low, emails, codes); this file translates them to PM's.
// Every call is logged in "erpIntegrationEvents" (outside the in-memory store, so the
// log can grow without slowing every read). A repeated eventId returns the first answer.

import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import multer from 'multer';
import store from '../store.js';
import { UPLOADS_DIR, resolveDocumentPath } from '../services/uploads.js';
import { CR_TASK_DEFINITIONS } from '../crTaskTemplates.js';
import {
  mapStatus, mapPriority, mapMilestone, htmlToText, crNameFrom, toPmDate, nameFromEmail, idKey, KNOWN_SEGMENTS,
} from '../services/erp-cr-mapper.js';

const router = express.Router();
const uuid = () => crypto.randomUUID();
const SOURCE = 'ERP';
const CHANGED_BY = 'ERP Integration';
const MAX_BATCH = 200;
const MAX_TEXT = 255; // ERP VARCHAR(255) columns
const MAX_RICH_TEXT = 20000; // ERP limits Change Request to 5,000 visible characters; HTML adds markup
const PM_ONLY_MILESTONES = new Set(['Changes', 'Fully Live']);
const PM_ORIGIN = (process.env.FRONTEND_URL || process.env.APP_PUBLIC_ORIGIN || 'http://localhost:8080').replace(/\/+$/, '');

// ---------------------------------------------------------------- access ----------
router.use((req, res, next) => {
  const u = req.user;
  if (u?.type === 'client') {
    if (!(u.scopes || []).includes('cr:sync')) return res.status(403).json({ error: 'Insufficient scope (cr:sync required)' });
    return next();
  }
  if (u?.isAdmin) return next(); // PM admins may call it by hand (testing)
  return res.status(403).json({ error: 'ERP integration access only' });
});

// ---------------------------------------------------------------- event log -------
let eventsTableReady = null;
function ensureEventsTable() {
  if (!eventsTableReady) {
    eventsTableReady = store.pool.query(`
      CREATE TABLE IF NOT EXISTS "erpIntegrationEvents" (
        "id" TEXT PRIMARY KEY,
        "eventId" TEXT,
        "ticketNumber" TEXT,
        "eventType" TEXT,
        "endpoint" TEXT,
        "clientId" TEXT,
        "receivedAt" TEXT NOT NULL,
        "httpStatus" INTEGER,
        "action" TEXT,
        "warnings" TEXT,
        "error" TEXT,
        "response" TEXT,
        "payload" TEXT
      );
      CREATE INDEX IF NOT EXISTS "erpIntegrationEvents_eventId" ON "erpIntegrationEvents" ("eventId");
      CREATE INDEX IF NOT EXISTS "erpIntegrationEvents_ticket" ON "erpIntegrationEvents" ("ticketNumber");
    `).catch((e) => { eventsTableReady = null; throw e; });
  }
  return eventsTableReady;
}

/** Earlier successful answers for these eventIds: Map(eventId -> response object). */
async function earlierAnswers(eventIds) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (!ids.length) return new Map();
  await ensureEventsTable();
  const { rows } = await store.pool.query(
    'SELECT "eventId", "response" FROM "erpIntegrationEvents" WHERE "eventId" = ANY($1) AND "httpStatus" = 200',
    [ids],
  );
  const out = new Map();
  for (const r of rows) {
    try { out.set(r.eventId, JSON.parse(r.response)); } catch { /* ignore unreadable rows */ }
  }
  return out;
}

async function logEvent(req, { eventId, ticketNumber, eventType, httpStatus, response, error, payload }) {
  try {
    await ensureEventsTable();
    await store.pool.query(
      `INSERT INTO "erpIntegrationEvents"("id","eventId","ticketNumber","eventType","endpoint","clientId","receivedAt","httpStatus","action","warnings","error","response","payload")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        uuid(), eventId || null, ticketNumber || null, eventType || null, `${req.method} ${req.baseUrl}${req.path}`,
        req.user?.clientId || req.user?.email || null, new Date().toISOString(), httpStatus,
        response?.action || null, response?.warnings?.length ? JSON.stringify(response.warnings) : null,
        error || null, response ? JSON.stringify(response) : null,
        payload === undefined ? null : JSON.stringify(payload).slice(0, 100000),
      ],
    );
  } catch (e) {
    console.error('[ERP SYNC] Could not log event:', e.message);
  }
}

// One ERP write at a time across all backend nodes, so two messages for the same new
// Ticket Number can't both create a CR.
async function withErpLock(fn) {
  const client = await store.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['erp-cr-sync']);
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['erp-cr-sync']).catch(() => {});
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- helpers ---------
class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

function optText(cr, k, max = MAX_TEXT) {
  const v = cr[k];
  if (v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw new InputError(`cr.${k} must be text`);
  const s = String(v).trim();
  if (s.length > max) throw new InputError(`cr.${k} may be at most ${max} characters`);
  return s || null;
}

function pmDate(cr, k) {
  const d = toPmDate(cr[k]);
  if (d === 'invalid') throw new InputError(`cr.${k} is not a valid date (use YYYY-MM-DD or ISO 8601)`);
  return d;
}

function readOccurredAt(body) {
  const raw = body?.occurredAt;
  if (!raw) throw new InputError('occurredAt is required (ISO 8601 timestamp of the ERP change)');
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new InputError('occurredAt is not a valid ISO 8601 timestamp');
  return d.toISOString();
}

const REQUIRED_FULL = [
  'ticketNumber', 'changeRequest', 'status', 'segment', 'stage',
  'requesterEmail', 'functionalEmail', 'dateCreation', 'targetResolved', 'createdAt',
];

function findCr(data, ticketNumber) {
  const key = idKey(ticketNumber);
  return (data.initiatives || []).find((i) => (i.externalIds || []).some((x) => idKey(x) === key)) || null;
}

function findUserByEmail(data, email, { activeOnly }) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return (data.users || []).find((u) => String(u.email || '').trim().toLowerCase() === e && (!activeOnly || u.active !== false)) || null;
}

const crTaskIndex = (milestone) => {
  const m = milestone === 'Changes' || milestone === 'Signed Changes' || milestone === 'Development - Extended' ? 'Development' : milestone;
  return CR_TASK_DEFINITIONS.findIndex((t) => t.milestone === m);
};

function pmUrl(initiativeId) {
  return `${PM_ORIGIN}/#view/${initiativeId}`;
}

// Fields compared for the Change History entry ERP updates leave.
const HISTORY_FIELDS = [
  'name', 'description', 'remark', 'priority', 'status', 'milestone', 'departmentId', 'businessOwnerId',
  'businessUserIds', 'itPicId', 'itPicIds', 'itManagerIds', 'systemImpactedIds', 'startDate', 'endDate',
  'planStartDate', 'planEndDate', 'erpModuleId', 'tCode', 'functionalDepartment', 'crReference',
  'ownershipCode', 'impactAreaCode',
];
const asText = (v) => (Array.isArray(v) ? v.join(',') : v) || null;

// ---------------------------------------------------------------- core ------------
/**
 * Apply one ERP message to `data` (in memory). mode = 'full' (PUT: create or update with
 * the whole CR) or 'partial' (PATCH: only the fields sent, CR must exist).
 * Returns the response body. Throws InputError for a bad message.
 */
function applyCr(data, body, mode, ticketFromPath) {
  if (!body || typeof body !== 'object') throw new InputError('Body must be a JSON object');
  const cr = body.cr;
  if (!cr || typeof cr !== 'object' || Array.isArray(cr)) throw new InputError('cr (object) is required');
  const occurredAt = readOccurredAt(body);

  if (ticketFromPath != null) {
    if (has(cr, 'ticketNumber') && idKey(cr.ticketNumber) !== idKey(ticketFromPath)) {
      throw new InputError('cr.ticketNumber does not match the Ticket Number in the URL');
    }
    if (!has(cr, 'ticketNumber')) cr.ticketNumber = ticketFromPath;
  }
  const ticketNumber = optText(cr, 'ticketNumber', 100);
  if (!ticketNumber) throw new InputError('cr.ticketNumber is required');
  if (ticketNumber.includes(',')) throw new InputError('cr.ticketNumber may not contain a comma');

  if (mode === 'full') {
    const missing = REQUIRED_FULL.filter((k) => cr[k] == null || String(cr[k]).trim() === '');
    if (missing.length) throw new InputError(`Missing required field(s): ${missing.map((k) => `cr.${k}`).join(', ')}`);
  }
  if (has(cr, 'segment') !== has(cr, 'stage')) throw new InputError('cr.segment and cr.stage must be sent together');
  validateCr(cr); // every check that can reject the message, before anything is changed

  let initiative = findCr(data, ticketNumber);
  if (initiative && initiative.type !== 'CR') {
    throw new InputError(`Ticket Number ${ticketNumber} is linked to a PM ${initiative.type}, not a CR`, 409);
  }
  if (!initiative && mode === 'partial') throw new InputError(`No CR with Ticket Number ${ticketNumber} in PM (create it with PUT first)`, 404);
  if (initiative?.externalSyncedAt && occurredAt <= initiative.externalSyncedAt) {
    return {
      action: 'ignored_stale', ticketNumber, initiativeId: initiative.id, pmTicket: initiative.ticket || null,
      pmUrl: pmUrl(initiative.id), warnings: [],
      message: `An ERP change from ${initiative.externalSyncedAt} was already applied; this one (${occurredAt}) is older.`,
    };
  }

  const warnings = [];
  const warn = (code, field, value, message) => warnings.push({ code, field, ...(value !== undefined ? { value } : {}), message });
  const set = {}; // PM fields to write
  const now = new Date().toISOString();
  const prevErp = initiative?.externalData || {};
  const erp = { ...prevErp }; // ERP-only details kept on the CR (externalData)

  // ---- texts: CR Name, Description (Note + Change Request), Remark (Note)
  if (has(cr, 'changeRequest')) {
    const html = optText(cr, 'changeRequest', MAX_RICH_TEXT);
    const text = htmlToText(html);
    if (!text) throw new InputError('cr.changeRequest has no text');
    set.name = crNameFrom(text);
    erp.changeRequestText = text;
  }
  if (has(cr, 'note')) {
    erp.note = optText(cr, 'note', MAX_RICH_TEXT) ? htmlToText(cr.note) : null;
    set.remark = erp.note;
  }
  if (has(cr, 'changeRequest') || has(cr, 'note')) {
    set.description = [erp.note, erp.changeRequestText].filter(Boolean).join('\n\n') || null;
  }

  // ---- plain ERP columns
  for (const k of ['tCode', 'functionalDepartment', 'crReference']) {
    if (has(cr, k)) set[k] = optText(cr, k);
  }
  for (const k of ['crId', 'url', 'type']) {
    if (has(cr, k)) erp[k] = optText(cr, k, k === 'url' ? 1000 : MAX_TEXT);
  }
  if (has(cr, 'projectType')) erp.projectType = cr.projectType === true || cr.projectType === 'true' || cr.projectType === 'Yes';
  if (body.eventType) erp.lastEventType = String(body.eventType).slice(0, 50);

  // ---- module -> ERP Module + System Impacted
  if (has(cr, 'moduleId')) {
    const moduleId = optText(cr, 'moduleId');
    if (moduleId && moduleId.includes(',')) throw new InputError('cr.moduleId may not contain a comma');
    if (!moduleId) {
      set.erpModuleId = null;
    } else {
      if (!data.erpModules) data.erpModules = [];
      let mod = data.erpModules.find((m) => m.id === moduleId);
      const moduleName = has(cr, 'moduleName') ? optText(cr, 'moduleName') : null;
      if (!mod && moduleName) {
        mod = { id: moduleId, name: moduleName, description: null, erpDepartmentId: null, isActive: true, createdAt: now, updatedAt: now };
        data.erpModules.push(mod);
      } else if (mod && moduleName && mod.name !== moduleName) {
        mod.name = moduleName;
        mod.updatedAt = now;
      }
      if (!mod) {
        warn('UNKNOWN_MODULE', 'cr.moduleId', moduleId, 'Module is not in PM\'s ERP module list; send cr.moduleName or load the modules first');
      } else {
        set.erpModuleId = moduleId;
        const apps = (data.dwsApplications || []).filter((a) => (a.externalIds || []).some((x) => idKey(x) === idKey(moduleId)));
        if (apps.length) set.systemImpactedIds = apps.map((a) => a.id);
        else warn('UNMAPPED_MODULE', 'cr.moduleId', moduleId, 'No System Impacted is mapped to this module yet; System Impacted left unchanged');
      }
    }
  }

  // ---- requester department -> Department
  if (has(cr, 'requesterDepartmentCode')) {
    const code = optText(cr, 'requesterDepartmentCode');
    if (!code) set.departmentId = null;
    else {
      const dept = (data.departments || []).find((d) => (d.externalIds || []).some((x) => idKey(x) === idKey(code)));
      if (dept) set.departmentId = dept.id;
      else warn('UNMAPPED_DEPARTMENT', 'cr.requesterDepartmentCode', code, 'No PM department has this External ID; Department left unchanged');
    }
  }

  // ---- Ownership / Impact Area (captured from ERP)
  for (const [k, kind, col] of [['ownership', 'ownership', 'ownershipCode'], ['impactArea', 'impactArea', 'impactAreaCode']]) {
    if (!has(cr, k)) continue;
    const v = cr[k];
    if (v == null) { set[col] = null; continue; }
    if (typeof v !== 'object' || Array.isArray(v)) throw new InputError(`cr.${k} must be an object { code, name }`);
    const code = optText(v, 'code');
    if (!code) throw new InputError(`cr.${k}.code is required`);
    const name = has(v, 'name') ? optText(v, 'name') : null;
    if (!data.erpOptions) data.erpOptions = [];
    const id = `${kind}:${code}`;
    const opt = data.erpOptions.find((o) => o.id === id);
    if (!opt) data.erpOptions.push({ id, kind, code, name: name || code, updatedAt: now });
    else if (name && opt.name !== name) { opt.name = name; opt.updatedAt = now; }
    set[col] = code;
  }

  // ---- priority / status
  if (has(cr, 'priority')) {
    const raw = optText(cr, 'priority');
    if (raw) {
      const p = mapPriority(raw);
      if (!p) throw new InputError('cr.priority must be High, Medium or Low');
      set.priority = p;
    }
  }
  if (has(cr, 'status')) {
    const s = mapStatus(cr.status);
    if (!s) throw new InputError('cr.status must be In Progress, Delayed, Completed or Cancelled');
    set.status = s;
    erp.status = String(cr.status).trim();
  }

  // ---- milestone from (segment, stage)
  if (has(cr, 'segment')) {
    const segment = optText(cr, 'segment');
    const stage = optText(cr, 'stage');
    const stageChanged = !initiative || prevErp.segment !== segment || prevErp.stage !== stage;
    erp.segment = segment;
    erp.stage = stage;
    const m = mapMilestone(segment, stage);
    if (!m) {
      warn('UNMAPPED_STAGE', 'cr.stage', `${segment} / ${stage}`, `Unknown segment/stage; Milestone left unchanged. Known segments: ${KNOWN_SEGMENTS.join(', ')}`);
    } else if (initiative && initiative.milestone === 'Fully Live' && m === 'Live (Warranty Period)') {
      // Fully Live is set in PM after the warranty period; GO-LIVE doesn't undo it.
    } else if (initiative && !stageChanged && PM_ONLY_MILESTONES.has(initiative.milestone)) {
      // Same ERP stage as last time: keep a PM-only milestone (Changes) set by hand since.
    } else {
      set.milestone = m;
    }
  }

  // ---- people
  if (has(cr, 'requesterEmail')) {
    const email = optText(cr, 'requesterEmail');
    const u = findUserByEmail(data, email, { activeOnly: true });
    if (u) { set.businessOwnerId = u.id; set.businessUserIds = [u.id]; }
    else if (email) warn('USER_UNMAPPED', 'cr.requesterEmail', email, 'No active PM user with this email; Business Owner / Business Users left unchanged');
    erp.requesterEmail = email;
  }
  if (has(cr, 'functionalEmail')) {
    const email = optText(cr, 'functionalEmail');
    const u = findUserByEmail(data, email, { activeOnly: true });
    if (u) { set.itPicId = u.id; set.itPicIds = [u.id]; }
    else if (email) warn('USER_UNMAPPED', 'cr.functionalEmail', email, 'No active PM user with this email; IT PIC left unchanged');
    erp.functionalEmail = email;
  }
  if (has(cr, 'deptHeadEmail')) {
    const email = optText(cr, 'deptHeadEmail');
    if (!email) set.itManagerIds = [];
    else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('cr.deptHeadEmail is not a valid email');
      let u = findUserByEmail(data, email, { activeOnly: false });
      if (!u) {
        // Created inactive: DWS Hub SSO signs in any existing, non-inactive user with a
        // matching email, so an active placeholder would grant PM access. An admin
        // activates the account on the Users page.
        u = {
          id: uuid(),
          name: (has(cr, 'deptHeadName') && optText(cr, 'deptHeadName')) || nameFromEmail(email),
          email: email.toLowerCase(),
          role: null, type: null, departmentId: null, active: false, passwordHash: null,
          isAdmin: false, emailActivated: false,
        };
        if (!data.users) data.users = [];
        data.users.push(u);
        warn('USER_CREATED', 'cr.deptHeadEmail', email, 'No PM user with this email: created an inactive user for the Dept Head (an admin can activate it)');
      }
      set.itManagerIds = [u.id];
    }
  }

  // ---- dates
  const dates = [['dateCreation', 'planStartDate'], ['targetResolved', 'planEndDate'], ['createdAt', 'startDate'], ['closedAt', 'endDate']];
  for (const [k, col] of dates) {
    if (has(cr, k)) set[col] = pmDate(cr, k);
  }

  erp.lastWarnings = warnings;
  erp.occurredAt = occurredAt;

  // ---- create or update
  let action;
  const changes = [];
  if (!initiative) {
    const id = uuid();
    initiative = {
      id, type: 'CR', name: set.name, ticket: generateCrTicket(data), description: null, businessImpact: null,
      priority: 'P2', businessOwnerId: null, businessUserIds: [], departmentId: null, itPicId: null, itPicIds: [],
      itPmId: null, itManagerIds: [], systemImpactedIds: [], status: null, milestone: null, crMilestonePhase: null,
      startDate: null, endDate: null, planStartDate: null, planEndDate: null, remark: null, documentationLink: null,
      externalIds: [ticketNumber], erpModuleId: null, tCode: null, functionalDepartment: null, crReference: null,
      ownershipCode: null, impactAreaCode: null, createdAt: now,
    };
    if (!set.milestone) set.milestone = 'CR Created';
    Object.assign(initiative, set);
    data.initiatives.push(initiative);
    if (!data.changeRequests) data.changeRequests = [];
    data.changeRequests.push({
      initiativeId: id, crSubmissionStart: initiative.planStartDate || null, crSubmissionEnd: null,
      developmentStart: null, developmentEnd: null, sitStart: null, sitEnd: null, uatStart: null, uatEnd: null, liveDate: null,
    });
    if (!data.tasks) data.tasks = [];
    for (const t of CR_TASK_DEFINITIONS) {
      data.tasks.push({
        id: uuid(), initiativeId: id, name: t.name, description: null, startDate: null, endDate: null,
        assigneeId: initiative.itPicId || null, status: 'not started', milestone: t.milestone, createdAt: now, updatedAt: null,
      });
    }
    action = 'created';
  } else {
    for (const [k, v] of Object.entries(set)) {
      const before = asText(initiative[k]);
      const after = asText(v);
      if (before !== after) {
        if (HISTORY_FIELDS.includes(k)) changes.push({ field: k, oldValue: before, newValue: after, changedAt: now, changedBy: CHANGED_BY });
        initiative[k] = v;
      }
    }
    if (has(cr, 'dateCreation')) {
      const crRow = (data.changeRequests || []).find((c) => c.initiativeId === initiative.id);
      if (crRow) crRow.crSubmissionStart = initiative.planStartDate || null;
    }
    action = changes.length ? 'updated' : 'unchanged';
  }

  initiative.externalSource = SOURCE;
  initiative.externalSyncedAt = occurredAt;
  initiative.externalData = erp;
  if (action !== 'unchanged') initiative.updatedAt = now;

  if (changes.length) {
    if (!data.changeHistory) data.changeHistory = [];
    data.changeHistory.push({ id: uuid(), initiativeId: initiative.id, changes, timestamp: now, changedBy: CHANGED_BY });
  }
  syncTasks(data, initiative, now);

  return {
    action, ticketNumber, initiativeId: initiative.id, pmTicket: initiative.ticket || null, pmUrl: pmUrl(initiative.id),
    changedFields: action === 'created' ? undefined : changes.map((c) => c.field), warnings,
  };
}

/**
 * All checks that reject a message, run before applyCr changes anything (so a rejected
 * item in a batch leaves no captured module / option / user behind).
 */
function validateCr(cr) {
  const textFields = {
    crId: MAX_TEXT, type: MAX_TEXT, url: 1000, changeRequest: MAX_RICH_TEXT, note: MAX_RICH_TEXT, moduleId: MAX_TEXT,
    moduleName: MAX_TEXT, tCode: MAX_TEXT, functionalDepartment: MAX_TEXT, crReference: MAX_TEXT,
    requesterDepartmentCode: MAX_TEXT, priority: MAX_TEXT, status: MAX_TEXT, segment: MAX_TEXT, stage: MAX_TEXT,
    requesterEmail: MAX_TEXT, functionalEmail: MAX_TEXT, deptHeadEmail: MAX_TEXT, deptHeadName: MAX_TEXT,
  };
  for (const [k, max] of Object.entries(textFields)) if (has(cr, k)) optText(cr, k, max);
  if (has(cr, 'changeRequest') && !htmlToText(cr.changeRequest)) throw new InputError('cr.changeRequest has no text');
  if (has(cr, 'moduleId') && String(cr.moduleId ?? '').includes(',')) throw new InputError('cr.moduleId may not contain a comma');
  if (has(cr, 'priority') && optText(cr, 'priority') && !mapPriority(cr.priority)) throw new InputError('cr.priority must be High, Medium or Low');
  if (has(cr, 'status') && !mapStatus(cr.status)) throw new InputError('cr.status must be In Progress, Delayed, Completed or Cancelled');
  for (const k of ['dateCreation', 'targetResolved', 'createdAt', 'closedAt']) if (has(cr, k)) pmDate(cr, k);
  const head = has(cr, 'deptHeadEmail') ? optText(cr, 'deptHeadEmail') : null;
  if (head && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(head)) throw new InputError('cr.deptHeadEmail is not a valid email');
  for (const k of ['ownership', 'impactArea']) {
    if (!has(cr, k) || cr[k] == null) continue;
    const v = cr[k];
    if (typeof v !== 'object' || Array.isArray(v)) throw new InputError(`cr.${k} must be an object { code, name }`);
    for (const f of ['code', 'name']) {
      if (v[f] != null && typeof v[f] !== 'string' && typeof v[f] !== 'number') throw new InputError(`cr.${k}.${f} must be text`);
      if (String(v[f] ?? '').trim().length > MAX_TEXT) throw new InputError(`cr.${k}.${f} may be at most ${MAX_TEXT} characters`);
    }
    if (!String(v.code ?? '').trim()) throw new InputError(`cr.${k}.code is required`);
  }
}

// CR tasks follow the milestone: tasks of passed milestones -> done; Cancelled -> cancel.
function syncTasks(data, initiative, now) {
  const tasks = (data.tasks || []).filter((t) => t.initiativeId === initiative.id);
  if (!tasks.length) return;
  const open = (t) => !['done', 'cancel'].includes(String(t.status || '').toLowerCase());
  if (initiative.status === 'Cancelled') {
    for (const t of tasks) if (open(t)) { t.status = 'cancel'; t.updatedAt = now; }
    return;
  }
  let idx = crTaskIndex(initiative.milestone);
  if (initiative.status === 'Live' && initiative.milestone === 'Fully Live') idx = CR_TASK_DEFINITIONS.length;
  if (idx < 0) return;
  for (const t of tasks) {
    const ti = CR_TASK_DEFINITIONS.findIndex((d) => d.milestone === t.milestone);
    if (ti >= 0 && ti < idx && open(t)) { t.status = 'done'; t.updatedAt = now; }
  }
}

// Same format as routes/initiatives.js generateCRTicketNumber: CR + DDMMYYYY + 3-digit run.
function generateCrTicket(data) {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  const prefix = `${get('day')}${get('month')}${get('year')}`;
  let max = 0;
  for (const i of data.initiatives || []) {
    const m = i.type === 'CR' && i.ticket ? String(i.ticket).match(/^CR(\d{8})(\d+)$/) : null;
    if (m && m[1] === prefix) max = Math.max(max, parseInt(m[2], 10));
  }
  return `CR${prefix}${String(max + 1).padStart(3, '0')}`;
}

function sendError(res, e) {
  if (e instanceof InputError) return res.status(e.status).json({ error: e.message });
  console.error('[ERP SYNC] Failed:', e);
  return res.status(500).json({ error: 'Internal error; retry later' });
}

// ---------------------------------------------------------------- routes ----------
async function handleOne(req, res, mode) {
  const ticket = req.params.ticketNumber;
  const body = req.body || {};
  const meta = { eventId: body.eventId ? String(body.eventId) : null, ticketNumber: ticket, eventType: body.eventType || null, payload: body };
  try {
    if (meta.eventId) {
      const earlier = (await earlierAnswers([meta.eventId])).get(meta.eventId);
      if (earlier) return res.json({ ...earlier, duplicateEvent: true });
    }
    const out = await withErpLock(async () => {
      const data = await store.read();
      const result = applyCr(data, body, mode, ticket);
      if (result.action !== 'ignored_stale') await store.write(data);
      return result;
    });
    const status = out.action === 'created' ? 201 : 200;
    res.status(status).json(out);
    logEvent(req, { ...meta, httpStatus: 200, response: out });
  } catch (e) {
    sendError(res, e);
    logEvent(req, { ...meta, httpStatus: e instanceof InputError ? e.status : 500, error: e.message });
  }
}

router.put('/crs/:ticketNumber', (req, res) => handleOne(req, res, 'full'));
router.patch('/crs/:ticketNumber', (req, res) => handleOne(req, res, 'partial'));

router.get('/crs/:ticketNumber', async (req, res) => {
  try {
    const data = await store.read();
    const i = findCr(data, req.params.ticketNumber);
    if (!i) return res.status(404).json({ error: `No CR with Ticket Number ${req.params.ticketNumber} in PM` });
    const user = (id) => {
      const u = (data.users || []).find((x) => x.id === id);
      return u ? { name: u.name, email: u.email, active: u.active !== false } : null;
    };
    const apps = new Map((data.dwsApplications || []).map((a) => [a.id, a.systemName]));
    const erpDoc = i.externalData?.documentId ? (data.documents || []).find((d) => d.id === i.externalData.documentId) : null;
    res.json({
      ticketNumber: (i.externalIds || [])[0] || req.params.ticketNumber,
      initiativeId: i.id,
      pmTicket: i.ticket || null,
      pmUrl: pmUrl(i.id),
      source: i.externalSource || null,
      lastOccurredAt: i.externalSyncedAt || null,
      name: i.name,
      status: i.status,
      milestone: i.milestone,
      priority: i.priority,
      planStartDate: i.planStartDate || null,
      planEndDate: i.planEndDate || null,
      actualStartDate: i.startDate || null,
      actualEndDate: i.endDate || null,
      businessOwner: user(i.businessOwnerId),
      itPic: user(i.itPicId),
      itManagers: (i.itManagerIds || []).map(user).filter(Boolean),
      itPm: user(i.itPmId),
      systemImpacted: (i.systemImpactedIds || []).map((id) => apps.get(id)).filter(Boolean),
      department: (data.departments || []).find((d) => d.id === i.departmentId)?.name || null,
      erp: i.externalData ? {
        segment: i.externalData.segment || null, stage: i.externalData.stage || null, status: i.externalData.status || null,
        moduleId: i.erpModuleId || null, tCode: i.tCode || null, functionalDepartment: i.functionalDepartment || null,
        crReference: i.crReference || null, ownershipCode: i.ownershipCode || null, impactAreaCode: i.impactAreaCode || null,
      } : null,
      document: erpDoc ? { fileName: erpDoc.fileName, sizeBytes: erpDoc.sizeBytes, uploadedAt: erpDoc.uploadedAt } : null,
      warnings: i.externalData?.lastWarnings || [],
    });
  } catch (e) {
    sendError(res, e);
  }
});

router.put('/crs', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Send { "items": [ ... ] } with at least one item' });
  if (items.length > MAX_BATCH) return res.status(400).json({ error: `At most ${MAX_BATCH} items per batch` });
  try {
    const earlier = await earlierAnswers(items.map((it) => (it?.eventId ? String(it.eventId) : null)));
    const results = await withErpLock(async () => {
      const data = await store.read();
      const out = [];
      let dirty = false;
      for (const [index, it] of items.entries()) {
        const eventId = it?.eventId ? String(it.eventId) : null;
        if (eventId && earlier.has(eventId)) { out.push({ index, httpStatus: 200, ...earlier.get(eventId), duplicateEvent: true }); continue; }
        try {
          const r = applyCr(data, it, 'full', null);
          if (r.action !== 'ignored_stale' && r.action !== 'unchanged') dirty = true;
          out.push({ index, httpStatus: r.action === 'created' ? 201 : 200, ...r });
        } catch (e) {
          if (!(e instanceof InputError)) throw e;
          out.push({ index, httpStatus: e.status, ticketNumber: it?.cr?.ticketNumber || null, error: e.message });
        }
      }
      if (dirty) await store.write(data);
      return out;
    });
    res.json({ results, created: results.filter((r) => r.action === 'created').length, updated: results.filter((r) => r.action === 'updated').length, failed: results.filter((r) => r.error).length });
    for (const [i, r] of results.entries()) {
      if (r.duplicateEvent) continue;
      const it = items[i] || {};
      logEvent(req, {
        eventId: it.eventId ? String(it.eventId) : null, ticketNumber: r.ticketNumber, eventType: it.eventType || 'batch',
        httpStatus: r.error ? r.httpStatus : 200, response: r.error ? undefined : r, error: r.error, payload: it,
      });
    }
  } catch (e) {
    sendError(res, e);
  }
});

// ---- document
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await fs.mkdir(UPLOADS_DIR, { recursive: true }); cb(null, UPLOADS_DIR); } catch (e) { cb(e); }
    },
    filename: (_req, file, cb) => cb(null, `${uuid()}-${file.originalname}`),
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

router.put('/crs/:ticketNumber/document', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File is larger than 30 MB' : err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Send the file as multipart/form-data field "file"' });
    const ticket = req.params.ticketNumber;
    try {
      const out = await withErpLock(async () => {
        const data = await store.read();
        const i = findCr(data, ticket);
        if (!i) throw new InputError(`No CR with Ticket Number ${ticket} in PM (create it with PUT first)`, 404);
        if (!data.documents) data.documents = [];
        const now = new Date().toISOString();
        // ERP holds one document per CR: the new file replaces the one ERP sent before.
        const oldId = i.externalData?.documentId;
        const old = oldId ? data.documents.find((d) => d.id === oldId) : null;
        if (old) data.documents = data.documents.filter((d) => d.id !== oldId);
        const doc = {
          id: uuid(), initiativeId: i.id, fileName: req.file.originalname, filePath: req.file.path,
          sizeBytes: req.file.size, uploadedBy: CHANGED_BY, uploadedAt: now,
        };
        data.documents.push(doc);
        i.externalData = { ...(i.externalData || {}), documentId: doc.id };
        await store.write(data);
        if (old?.filePath) {
          const p = await resolveDocumentPath(old.filePath);
          if (p) await fs.unlink(p).catch(() => {});
        }
        return { action: old ? 'replaced' : 'added', ticketNumber: ticket, initiativeId: i.id, documentId: doc.id, fileName: doc.fileName, sizeBytes: doc.sizeBytes };
      });
      res.json(out);
      logEvent(req, { ticketNumber: ticket, eventType: 'document', httpStatus: 200, response: out, payload: { fileName: req.file.originalname, sizeBytes: req.file.size } });
    } catch (e) {
      await fs.unlink(req.file.path).catch(() => {});
      sendError(res, e);
      logEvent(req, { ticketNumber: ticket, eventType: 'document', httpStatus: e instanceof InputError ? e.status : 500, error: e.message });
    }
  });
});

// ---- ERP module master
router.put('/modules', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Send { "items": [ { "id", "name", "isActive" } ] }' });
  if (items.length > 2000) return res.status(400).json({ error: 'At most 2000 modules per request' });
  const parsed = [];
  const seen = new Set();
  for (const [n, m] of items.entries()) {
    const id = String(m?.id ?? '').trim();
    const name = String(m?.name ?? '').trim();
    if (!id || !name) return res.status(400).json({ error: `Item ${n}: id and name are required` });
    if (id.includes(',')) return res.status(400).json({ error: `Item ${n}: id may not contain a comma` });
    if (id.length > MAX_TEXT || name.length > MAX_TEXT) return res.status(400).json({ error: `Item ${n}: id and name may be at most ${MAX_TEXT} characters` });
    if (seen.has(id)) return res.status(400).json({ error: `Item ${n}: module ${id} appears twice` });
    seen.add(id);
    parsed.push({
      id, name,
      description: m.description != null ? String(m.description).trim() || null : null,
      erpDepartmentId: m.departmentId != null ? String(m.departmentId).trim() || null : null,
      isActive: m.isActive !== false,
    });
  }
  try {
    const out = await withErpLock(async () => {
      const data = await store.read();
      if (!data.erpModules) data.erpModules = [];
      const byId = new Map(data.erpModules.map((m) => [m.id, m]));
      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;
      for (const m of parsed) {
        const ex = byId.get(m.id);
        if (!ex) { data.erpModules.push({ ...m, createdAt: now, updatedAt: now }); created += 1; continue; }
        if (['name', 'description', 'erpDepartmentId', 'isActive'].some((k) => (ex[k] ?? null) !== (m[k] ?? null))) {
          Object.assign(ex, m, { updatedAt: now });
          updated += 1;
        }
      }
      if (created || updated) await store.write(data);
      return { created, updated, unchanged: parsed.length - created - updated };
    });
    res.json(out);
    logEvent(req, { eventType: 'modules', httpStatus: 200, response: { action: 'modules', ...out } });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
export { applyCr }; // for tests
