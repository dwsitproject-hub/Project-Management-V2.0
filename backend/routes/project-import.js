// Admin: bulk upload of a project list from an Excel planning template
// (columns: Type, Initiative Name, Department, Business Owner, IT PM, IT PIC, Status,
//  Notes / Decision needed, Plan Start Date, Plan End Date, Priority; optional Milestone).
//
//   GET  /template  → blank .xlsx in the expected layout
//   POST /preview   → parse the uploaded file (nothing is saved): normalized rows, row
//                     errors, the people / status values found and suggested mappings
//   POST /commit    → create (or update) projects from the reviewed rows + mappings
//
// Mounted behind authenticateToken + requireAdmin.

import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import XLSX from 'xlsx';
import store from '../store.js';
import { PROJECT_MILESTONES, normalizeProjectMilestone, isValidProjectMilestone } from '../projectMilestones.js';
import { normalizeDepartmentName } from '../departmentGroups.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const PM_STATUSES = ['Not Started', 'On Hold', 'On Track', 'At Risk', 'Delayed', 'Live', 'Cancelled'];
const PRIORITIES = ['P0', 'P1', 'P2'];
const MAX_ROWS = 1000;

// Template status → PM status + milestone (editable in the preview).
const STATUS_SUGGESTIONS = {
  'not started': { status: 'Not Started', milestone: 'Preparation' },
  'in progress': { status: 'On Track', milestone: 'Development' },
  'on track': { status: 'On Track', milestone: 'Development' },
  'at risk': { status: 'At Risk', milestone: 'Development' },
  delayed: { status: 'Delayed', milestone: 'Development' },
  done: { status: 'Live', milestone: 'Live (Warranty Period)' },
  live: { status: 'Live', milestone: 'Live (Warranty Period)' },
  deferred: { status: 'On Hold', milestone: 'Preparation' },
  'on hold': { status: 'On Hold', milestone: 'Preparation' },
  cancelled: { status: 'Cancelled', milestone: 'Preparation' },
};

// Header text → field. First matching column wins.
const COLUMNS = {
  type: ['type', 'initiative type'],
  name: ['initiative name', 'project name', 'name', 'initiative'],
  itPm: ['it pm', 'itpm', 'pm'],
  itPic: ['it pic', 'it dev', 'itpic', 'pic'],
  status: ['status'],
  notes: ['notes / decision needed', 'notes', 'remark', 'remarks', 'decision needed'],
  planStart: ['plan start date', 'plan start', 'start date', 'start'],
  planEnd: ['plan end date', 'plan end', 'end date', 'end'],
  priority: ['priority'],
  milestone: ['milestone'],
  department: ['department', 'dept'],
  businessOwner: ['business owner', 'owner', 'bo'],
};

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const normKey = (v) => norm(v).toLowerCase();
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Cell → { y, m, d|null } (d null = month only). Accepts Excel dates, "Oct-27",
 * "Oct 2027", "October-2027", "2027-10", "2027-10-15", "10/2027", "15/10/2027".
 */
function parseCellDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel stores whole dates at local midnight; read local parts.
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  const s = norm(v);
  if (!s) return null;
  let m = /^([A-Za-z]{3,9})[\s\-/']*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi === -1) return null;
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return { y, m: mi + 1, d: null };
  }
  m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : null };
  m = /^(?:(\d{1,2})\/)?(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return { y: +m[3], m: +m[2], d: m[1] ? +m[1] : null };
  return null;
}

function toIsoDate(p, isEnd) {
  if (!p || p.m < 1 || p.m > 12 || p.y < 2000 || p.y > 2100) return null;
  const last = daysIn(p.y, p.m);
  const d = p.d == null ? (isEnd ? last : 1) : p.d;
  if (d < 1 || d > last) return null;
  return `${p.y}-${pad(p.m)}-${pad(d)}`;
}

const splitPeople = (v) => norm(v).split(/\s*(?:,|;|\/|&|\band\b)\s*/i).map(norm).filter(Boolean);

/** Best user for a short name like "Jerry", "Pohan" or "Rian D" (null when none/ambiguous). */
function matchUser(name, users) {
  const key = normKey(name);
  if (!key || /^(unassigned|tbd|tba|-|n\/a|none)$/.test(key) || /^new hire\b/.test(key)) {
    return { userId: null, candidates: [] };
  }
  const tokens = key.split(' ');
  const scored = [];
  for (const u of users) {
    const full = normKey(u.name || '');
    const words = full.split(' ').filter(Boolean);
    const local = String(u.email || '').toLowerCase().split('@')[0];
    let score = 0;
    if (full === key) score = 100;
    else if (tokens.every((t) => words.some((w) => w.startsWith(t)))) {
      score = 50 + tokens.filter((t) => words.includes(t)).length * 10 + (words[0] === tokens[0] ? 5 : 0);
    } else if (local === key.replace(/\s+/g, '.') || local.startsWith(tokens[0])) score = 20;
    if (score) scored.push({ u, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tied = top ? scored.filter((s) => s.score === top.score) : [];
  return {
    userId: top && tied.length === 1 ? top.u.id : null,
    candidates: scored.slice(0, 5).map((s) => ({ id: s.u.id, name: s.u.name || s.u.email })),
  };
}

/**
 * PM department for a file value. Departments are matched by the name PM shows
 * (normalizeDepartmentName: "Operation" is shown as "Industrial", "Trader" as "Commercial"),
 * exact (any case) first, else a unique prefix match.
 */
function matchDepartment(value, departments) {
  const key = normKey(value);
  if (!key) return null;
  const shown = departments.map((d) => ({ id: d.id, names: [normKey(d.name), normKey(normalizeDepartmentName(d.name))] }));
  const exact = shown.filter((d) => d.names.includes(key));
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null; // e.g. two departments both shown as "Commercial": let the admin choose
  if (key.length < 3) return null;
  const partial = shown.filter((d) => d.names.some((n) => n.length >= 3 && (n.startsWith(key) || key.startsWith(n))));
  return partial.length === 1 ? partial[0].id : null;
}

function findColumns(headerRow) {
  const idx = {};
  const headers = headerRow.map(normKey);
  for (const [field, names] of Object.entries(COLUMNS)) {
    const k = headers.findIndex((h, i) => names.includes(h) && !Object.values(idx).includes(i));
    if (k !== -1) idx[field] = k;
  }
  return idx;
}

// ---------------------------------------------------------------------------
router.get('/template', (_req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Type', 'Initiative Name', 'Department', 'Business Owner', 'Priority', 'IT PM', 'IT PIC', 'Status', 'Notes / Decision needed', 'Plan Start Date', 'Plan End Date'],
    ['Project', 'Example project name', 'Logistic', 'Dinna Medhani', 'P1', 'Jerry', 'Jerry, Stevanus', 'Not Started', 'Optional note', 'Jan-27', 'Mar-27'],
  ]);
  ws['!cols'] = [{ wch: 10 }, { wch: 50 }, { wch: 16 }, { wch: 20 }, { wch: 9 }, { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 40 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Proposed Plan');
  const help = XLSX.utils.aoa_to_sheet([
    ['Column', 'Values'],
    ['Type', 'Project'],
    ['IT PM / IT PIC', 'Name as in PM (e.g. "Jerry" or "Rian D"); several IT PICs separated by commas. "UNASSIGNED" / "New Hire …" are left empty.'],
    ['Status', 'Not Started, In Progress, At Risk, Done, Deferred (or PM statuses); mapped to PM status + milestone during upload'],
    ['Plan Start / End Date', 'Month as Mmm-YY (e.g. Oct-26 = 1 Oct 2026 for start, 31 Oct 2026 for end) or a full date'],
    ['Department', 'Department name as in PM (e.g. Logistic, HC). Names PM does not have can be mapped during upload.'],
    ['Business Owner', 'Name as in PM (e.g. "Dinna Medhani" or "Victor")'],
    ['Priority', 'P0, P1 or P2 (empty = the default chosen during upload)'],
    ['Optional columns', 'Milestone (a Project milestone; otherwise it follows the status mapping)'],
  ]);
  help['!cols'] = [{ wch: 22 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, help, 'How to fill');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="PM-project-upload-template.xlsx"');
  res.send(buf);
});

router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose an .xlsx file to upload' });
    if (!/\.(xlsx|xls)$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ error: 'Only Excel files (.xlsx) are supported' });
    }
    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    } catch (_) {
      return res.status(400).json({ error: 'Could not read this file as an Excel workbook' });
    }

    // Use the first sheet whose header row has an Initiative Name column.
    let sheetName = null;
    let table = null;
    let cols = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const c = rows.length ? findColumns(rows[0]) : {};
      if (c.name !== undefined) { sheetName = name; table = rows; cols = c; break; }
    }
    if (!table) return res.status(400).json({ error: 'No sheet with an "Initiative Name" column was found' });
    const missing = ['planStart', 'planEnd'].filter((f) => cols[f] === undefined);
    if (missing.length) {
      return res.status(400).json({ error: `Missing column(s): ${missing.map((f) => (f === 'planStart' ? 'Plan Start Date' : 'Plan End Date')).join(', ')}` });
    }

    const data = await store.read();
    const users = (data.users || []).filter((u) => u.active !== false);
    const existingByName = new Map(
      (data.initiatives || []).filter((i) => i.type === 'Project').map((i) => [normKey(i.name), i.id])
    );

    const cell = (row, f) => (cols[f] === undefined ? '' : row[cols[f]]);
    const body = table.slice(1).filter((r) => r.some((v) => norm(v) !== ''));
    if (body.length > MAX_ROWS) return res.status(400).json({ error: `Too many rows (${body.length}); the limit is ${MAX_ROWS}` });

    const seen = new Map();
    const rows = body.map((r, k) => {
      const rowNumber = table.indexOf(r) + 1; // spreadsheet row number
      const errors = [];
      const name = norm(cell(r, 'name'));
      const type = norm(cell(r, 'type')) || 'Project';
      const startRaw = cell(r, 'planStart');
      const endRaw = cell(r, 'planEnd');
      const planStartDate = toIsoDate(parseCellDate(startRaw), false);
      const planEndDate = toIsoDate(parseCellDate(endRaw), true);
      if (!name) errors.push('Initiative Name is empty');
      if (type.toLowerCase() !== 'project') errors.push(`Type "${type}" is not supported (only Project)`);
      if (!planStartDate) errors.push(`Plan Start Date "${norm(startRaw instanceof Date ? startRaw.toISOString() : startRaw)}" is not a month/date`);
      if (!planEndDate) errors.push(`Plan End Date "${norm(endRaw instanceof Date ? endRaw.toISOString() : endRaw)}" is not a month/date`);
      if (planStartDate && planEndDate && planEndDate < planStartDate) errors.push('Plan End Date is before Plan Start Date');
      const key = normKey(name);
      if (key && seen.has(key)) errors.push(`Same name as row ${seen.get(key)}`);
      else if (key) seen.set(key, rowNumber);
      const priorityRaw = norm(cell(r, 'priority'));
      const priority = priorityRaw.toUpperCase();
      const warnings = priorityRaw && !PRIORITIES.includes(priority)
        ? [`Priority "${priorityRaw}" is not P0, P1 or P2 — the default is used`] : [];
      return {
        rowNumber: rowNumber || k + 2,
        name,
        itPm: splitPeople(cell(r, 'itPm')),
        itPic: splitPeople(cell(r, 'itPic')),
        statusRaw: norm(cell(r, 'status')) || 'Not Started',
        notes: norm(cell(r, 'notes')) || null,
        planStartDate,
        planEndDate,
        priority: PRIORITIES.includes(priority) ? priority : null,
        warnings,
        milestoneRaw: norm(cell(r, 'milestone')) || null,
        departmentRaw: norm(cell(r, 'department')) || null,
        businessOwner: splitPeople(cell(r, 'businessOwner')).slice(0, 1),
        existingId: existingByName.get(key) || null,
        errors,
      };
    });

    const peopleCount = new Map();
    const peopleRoles = new Map();
    const addPerson = (p, role) => {
      if (!peopleRoles.has(p)) peopleRoles.set(p, new Set());
      peopleRoles.get(p).add(role);
    };
    for (const r of rows) {
      for (const p of new Set([...r.itPm, ...r.itPic, ...r.businessOwner])) peopleCount.set(p, (peopleCount.get(p) || 0) + 1);
      [...r.itPm, ...r.itPic].forEach((p) => addPerson(p, 'IT PM / PIC'));
      r.businessOwner.forEach((p) => addPerson(p, 'Business Owner'));
    }
    const people = [...peopleCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, roles: [...peopleRoles.get(name)], ...matchUser(name, users) }));

    const statusCount = new Map();
    for (const r of rows) statusCount.set(r.statusRaw, (statusCount.get(r.statusRaw) || 0) + 1);
    const statuses = [...statusCount.entries()].map(([value, count]) => {
      const exact = PM_STATUSES.find((s) => s.toLowerCase() === value.toLowerCase());
      const sug = STATUS_SUGGESTIONS[value.toLowerCase()] || { status: exact || 'Not Started', milestone: 'Preparation' };
      return { value, count, status: sug.status, milestone: sug.milestone };
    });

    const deptCount = new Map();
    for (const r of rows) if (r.departmentRaw) deptCount.set(r.departmentRaw, (deptCount.get(r.departmentRaw) || 0) + 1);
    const departments = [...deptCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count, departmentId: matchDepartment(value, data.departments || []) }));

    for (const r of rows) {
      if (r.milestoneRaw && !isValidProjectMilestone(r.milestoneRaw)) {
        r.warnings = [...(r.warnings || []), `Milestone "${r.milestoneRaw}" is not a Project milestone; the status mapping is used`];
        r.milestoneRaw = null;
      }
    }

    res.json({
      fileName: req.file.originalname,
      sheet: sheetName,
      rows,
      people,
      departments,
      statuses,
      options: { statuses: PM_STATUSES, milestones: PROJECT_MILESTONES, priorities: PRIORITIES },
    });
  } catch (e) {
    console.error('[project-import preview]', e);
    res.status(500).json({ error: 'Failed to read the file' });
  }
});

router.post('/commit', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { rows, peopleMap = {}, statusMap = {}, departmentMap = {}, defaults = {}, duplicateMode = 'skip', fileName = '' } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows to import' });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Too many rows; the limit is ${MAX_ROWS}` });
    if (!['skip', 'update'].includes(duplicateMode)) return res.status(400).json({ error: 'Invalid duplicateMode' });

    const data = await store.read();
    const userIds = new Set((data.users || []).map((u) => u.id));
    const deptIds = new Set((data.departments || []).map((d) => d.id));
    const priority = PRIORITIES.includes(defaults.priority) ? defaults.priority : 'P2';
    const departmentId = deptIds.has(defaults.departmentId) ? defaults.departmentId : null;
    const businessOwnerId = userIds.has(defaults.businessOwnerId) ? defaults.businessOwnerId : null;
    const itManagerIds = (Array.isArray(defaults.itManagerIds) ? defaults.itManagerIds : []).filter((id) => userIds.has(id));
    const changedBy = req.user?.id || 'Unknown';
    const source = `Uploaded from ${String(fileName).slice(0, 120) || 'Excel'}`;

    const resolve = (names) => [...new Set((names || []).map((n) => peopleMap[n]).filter((id) => id && userIds.has(id)))];
    const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

    const byName = new Map((data.initiatives || []).filter((i) => i.type === 'Project').map((i) => [normKey(i.name), i]));
    if (!data.tasks) data.tasks = [];
    if (!data.changeHistory) data.changeHistory = [];
    const result = { created: 0, updated: 0, skipped: 0, failed: [] };
    const fail = (r, error) => result.failed.push({ rowNumber: r.rowNumber, name: r.name || '', error });
    const stamp = now();

    for (const r of rows) {
      const name = norm(r.name);
      if (!name) { fail(r, 'Initiative Name is empty'); continue; }
      if (!isDate(r.planStartDate) || !isDate(r.planEndDate)) { fail(r, 'Plan Start / End Date is missing or invalid'); continue; }
      if (r.planEndDate < r.planStartDate) { fail(r, 'Plan End Date is before Plan Start Date'); continue; }
      const map = statusMap[r.statusRaw] || {};
      const status = PM_STATUSES.includes(map.status) ? map.status : null;
      if (!status) { fail(r, `No PM status chosen for "${r.statusRaw}"`); continue; }
      const milestone = normalizeProjectMilestone(r.milestoneRaw && isValidProjectMilestone(r.milestoneRaw) ? r.milestoneRaw : map.milestone);
      if (!isValidProjectMilestone(milestone)) { fail(r, `No milestone chosen for "${r.statusRaw}"`); continue; }
      const pmIds = resolve(r.itPm);
      const picIds = resolve(r.itPic);
      // The row's own Department / Business Owner (when mapped) win over the defaults.
      const rowDeptId = r.departmentRaw && deptIds.has(departmentMap[r.departmentRaw]) ? departmentMap[r.departmentRaw] : null;
      const rowOwnerId = resolve(r.businessOwner)[0] || null;
      const notes = r.notes ? String(r.notes).slice(0, 5000) : null;

      const existing = byName.get(normKey(name));
      if (existing) {
        if (duplicateMode === 'skip') { result.skipped++; continue; }
        const patch = {
          planStartDate: r.planStartDate,
          planEndDate: r.planEndDate,
          status,
          ...(pmIds[0] ? { itPmId: pmIds[0] } : {}),
          ...(picIds.length ? { itPicIds: picIds } : {}),
          ...(rowDeptId ? { departmentId: rowDeptId } : {}),
          ...(rowOwnerId ? { businessOwnerId: rowOwnerId } : {}),
          ...(PRIORITIES.includes(r.priority) ? { priority: r.priority } : {}),
          ...(notes ? { remark: notes } : {}),
        };
        const changes = [];
        for (const [field, value] of Object.entries(patch)) {
          const oldVal = Array.isArray(existing[field]) ? existing[field].join(',') : existing[field] ?? null;
          const newVal = Array.isArray(value) ? value.join(',') : value;
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            changes.push({ field, oldValue: oldVal, newValue: newVal, changedAt: stamp, changedBy });
            existing[field] = value;
          }
        }
        if (changes.length) {
          existing.updatedAt = stamp;
          data.changeHistory.push({ id: uuid(), initiativeId: existing.id, changes, timestamp: stamp, changedBy });
          result.updated++;
        } else {
          result.skipped++;
        }
        continue;
      }

      const id = uuid();
      const initiative = {
        id,
        type: 'Project',
        name,
        ticket: null,
        description: null,
        businessImpact: null,
        priority: PRIORITIES.includes(r.priority) ? r.priority : priority,
        businessOwnerId: rowOwnerId || businessOwnerId,
        businessUserIds: [],
        departmentId: rowDeptId || departmentId,
        itPicId: picIds[0] || null,
        itPicIds: picIds,
        itPmId: pmIds[0] || null,
        itManagerIds,
        systemImpactedIds: [],
        status,
        milestone,
        crMilestonePhase: null,
        startDate: null,
        endDate: null,
        planStartDate: r.planStartDate,
        planEndDate: r.planEndDate,
        remark: notes,
        documentationLink: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      data.initiatives.push(initiative);
      byName.set(normKey(name), initiative);
      // Same milestone tasks a Project created in the UI gets.
      for (const m of PROJECT_MILESTONES) {
        data.tasks.push({
          id: uuid(), initiativeId: id, name: `${m} Task`, description: `Task for ${m} milestone`,
          startDate: null, endDate: null, assigneeId: null, status: 'Not Started', milestone: m,
          createdAt: stamp, updatedAt: null,
        });
      }
      data.changeHistory.push({
        id: uuid(), initiativeId: id, timestamp: stamp, changedBy,
        changes: [{ field: 'created', oldValue: null, newValue: source, changedAt: stamp, changedBy }],
      });
      result.created++;
    }

    if (result.created || result.updated) await store.write(data);
    console.log(`[project-import] ${source}: created ${result.created}, updated ${result.updated}, skipped ${result.skipped}, failed ${result.failed.length}`);
    res.json(result);
  } catch (e) {
    console.error('[project-import commit]', e);
    res.status(500).json({ error: e.message || 'Import failed' });
  }
});

export default router;
