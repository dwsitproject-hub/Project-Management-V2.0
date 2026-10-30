// Public integration API (API Consumers): list + partial update of initiatives.
//
//   /api/v1/initiatives/list, PATCH /api/v1/initiatives/:id
//       Caller chooses the initiative type: body `type` = "CR" | "Project" (required).
//       On PATCH the type must match the stored initiative, so an integration can't
//       update a Project when it meant a CR (or the reverse).
//   /api/v1/crs/list, PATCH /api/v1/crs/:id
//       The original CR-only API (v1.1), unchanged; type is fixed to CR.
//
// Scopes: CR needs cr:read / cr:write, Project needs project:read / project:write.
// Interactive user tokens (normal PM login) skip scope checks, as before.

import express from 'express';
import store from '../store.js';
import {
  normalizeCrMilestonePhase,
  isValidCrMilestonePhase,
  crMilestoneMatchesFilter,
  requiresCrFullyLiveEndDate,
} from '../crTaskTemplates.js';
import {
  normalizeProjectMilestone,
  isValidProjectMilestone,
  projectMilestoneMatchesFilter,
} from '../projectMilestones.js';

// Per-type rules. `cr` = the type has the nested `cr` change-request dates object.
const TYPES = {
  CR: {
    readScope: 'cr:read',
    writeScope: 'cr:write',
    normalizeMilestone: normalizeCrMilestonePhase,
    isValidMilestone: isValidCrMilestonePhase,
    milestoneMatches: crMilestoneMatchesFilter,
    invalidMilestoneError: 'Invalid CR milestone phase',
    // Actual End Date required when Status=Live and Milestone=Fully Live (same rule as the UI).
    requiresEndDate: requiresCrFullyLiveEndDate,
    cr: true,
  },
  Project: {
    readScope: 'project:read',
    writeScope: 'project:write',
    normalizeMilestone: normalizeProjectMilestone,
    isValidMilestone: isValidProjectMilestone,
    milestoneMatches: projectMilestoneMatchesFilter,
    invalidMilestoneError: 'Invalid Project milestone',
    requiresEndDate: () => false,
    cr: false,
  },
};

const UPDATABLE_FIELDS = [
  'ticket',
  'name',
  'description',
  'businessImpact',
  'priority',
  'businessOwnerId',
  'businessUserIds',
  'departmentId',
  'itPicId',
  'itPicIds',
  'itPmId',
  'itManagerIds',
  'systemImpactedIds',
  'status',
  'milestone',
  'startDate',
  'endDate',
  'planStartDate',
  'planEndDate',
  'remark',
  'documentationLink',
];

const CR_DATE_FIELDS = [
  'crSubmissionStart',
  'crSubmissionEnd',
  'developmentStart',
  'developmentEnd',
  'sitStart',
  'sitEnd',
  'uatStart',
  'uatEnd',
  'liveDate',
];

function parseArray(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return null;
}

function normalizeUpper(v) {
  return String(v || '').toUpperCase().trim();
}

// Positive integer from the request, else the default (a non-number used to give NaN paging).
function toPositiveInt(v, fallback) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/** "CR" | "Project" from a caller-supplied value (case-insensitive), else null. */
function resolveType(value) {
  const key = String(value || '').trim().toLowerCase();
  return Object.keys(TYPES).find((t) => t.toLowerCase() === key) || null;
}

// Same idea as requireScopes(), but for a scope only known once the type is resolved.
function hasScope(req, scope) {
  if (req.user?.type === 'user') return true;
  return (req.user?.scopes || []).includes(scope);
}

function applyFilters(rows, reqBody, rules) {
  const q = reqBody?.q ? String(reqBody.q) : '';
  const filters = reqBody?.filters || {};

  const statusValues = parseArray(filters.status)?.map(normalizeUpper) || null;
  const priorityValues = parseArray(filters.priority)?.map(normalizeUpper) || null;
  const milestoneValues = parseArray(filters.milestone) || null;
  const deptValues = parseArray(filters.departmentId) || null;
  const itPicValues = parseArray(filters.itPicId) || null;
  const itPmValues = parseArray(filters.itPmId) || null;
  const boValues = parseArray(filters.businessOwnerId) || null;
  const systemImpactedValues = parseArray(filters.systemImpactedId) || parseArray(filters.systemImpactedIds) || null;
  const active = filters.active === true;

  if (q) {
    const qLower = q.toLowerCase();
    rows = rows.filter((r) => {
      return (
        String(r.name || '').toLowerCase().includes(qLower) ||
        String(r.description || '').toLowerCase().includes(qLower) ||
        String(r.ticket || '').toLowerCase().includes(qLower)
      );
    });
  }

  if (active) {
    rows = rows.filter((r) => normalizeUpper(r.status) !== 'NOT STARTED');
  }

  if (statusValues?.length) {
    rows = rows.filter((r) => statusValues.includes(normalizeUpper(r.status)));
  }
  if (priorityValues?.length) {
    rows = rows.filter((r) => priorityValues.includes(normalizeUpper(r.priority)));
  }
  if (milestoneValues?.length) {
    rows = rows.filter((r) => rules.milestoneMatches(r.milestone, milestoneValues));
  }
  if (deptValues?.length) {
    rows = rows.filter((r) => deptValues.includes(r.departmentId));
  }
  if (itPicValues?.length) {
    rows = rows.filter((r) => itPicValues.includes(r.itPicId));
  }
  if (itPmValues?.length) {
    rows = rows.filter((r) => itPmValues.includes(r.itPmId));
  }
  if (boValues?.length) {
    rows = rows.filter((r) => boValues.includes(r.businessOwnerId));
  }
  if (systemImpactedValues?.length) {
    rows = rows.filter((r) => {
      const raw = r.systemImpactedIds || [];
      const ids = Array.isArray(raw)
        ? raw
        : String(raw).split(',').map((x) => x.trim()).filter(Boolean);
      return systemImpactedValues.some((sel) => ids.includes(sel));
    });
  }

  return rows;
}

function applySort(rows, sort) {
  const field = String(sort?.field || 'updatedAt');
  const dir = String(sort?.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const compare = (a, b) => {
    const av = a?.[field] ?? '';
    const bv = b?.[field] ?? '';
    const cmp = String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  };

  return rows.slice().sort(compare);
}

async function listInitiatives(req, res, type) {
  try {
    const rules = TYPES[type];
    if (!hasScope(req, rules.readScope)) return res.status(403).json({ error: 'Insufficient scope' });

    const page = toPositiveInt(req.body?.page, 1);
    const pageSize = Math.min(500, toPositiveInt(req.body?.pageSize, 100));

    const data = await store.read();
    let rows = (data.initiatives || []).filter((i) => i.type === type);
    rows = applyFilters(rows, req.body, rules);
    rows = applySort(rows, req.body?.sort);

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize).map((initiative) => {
      const item = { ...initiative, milestone: rules.normalizeMilestone(initiative.milestone) };
      if (rules.cr) {
        item.cr = (data.changeRequests || []).find((cr) => cr.initiativeId === initiative.id) || null;
      }
      return item;
    });

    res.json({ items, page, pageSize, total });
  } catch (e) {
    console.error('[api-v1 POST /list]', e);
    res.status(500).json({ error: e.message || 'Failed to list initiatives' });
  }
}

async function updateInitiative(req, res, type) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const rules = TYPES[type];
    if (!hasScope(req, rules.writeScope)) return res.status(403).json({ error: 'Insufficient scope' });

    const data = await store.read();
    const idx = (data.initiatives || []).findIndex((i) => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const stored = data.initiatives[idx];
    if (stored.type !== type) {
      return res.status(400).json({ error: `Not a ${type} initiative (this id is a ${stored.type})` });
    }

    if ('milestone' in body && body.milestone != null && body.milestone !== '') {
      if (!rules.isValidMilestone(body.milestone)) {
        return res.status(400).json({ error: rules.invalidMilestoneError });
      }
    }
    if (!rules.cr && body.cr != null) {
      return res.status(400).json({ error: 'cr dates apply to CR initiatives only' });
    }

    for (const k of UPDATABLE_FIELDS) {
      if (!(k in body)) continue;
      let v = body[k];
      if (k === 'milestone' && v != null && v !== '') {
        v = rules.normalizeMilestone(v);
      }
      if (k === 'businessUserIds' || k === 'itPicIds' || k === 'itManagerIds') {
        stored[k] = Array.isArray(v) ? v : v == null ? [] : [String(v)];
      } else {
        stored[k] = v;
      }
    }
    stored.updatedAt = new Date().toISOString();

    if (rules.requiresEndDate(stored.status, stored.milestone) && (!stored.endDate || String(stored.endDate).trim() === '')) {
      return res.status(400).json({
        error:
          'Missing required field: endDate (required when Status is Live and Milestone is Fully Live)',
      });
    }

    if (rules.cr && body.cr && typeof body.cr === 'object') {
      if (!data.changeRequests) data.changeRequests = [];
      let cr = data.changeRequests.find((x) => x.initiativeId === id);
      if (!cr) {
        cr = { initiativeId: id };
        data.changeRequests.push(cr);
      }
      for (const k of CR_DATE_FIELDS) {
        if (k in body.cr) cr[k] = body.cr[k];
      }
    }

    await store.write(data);
    res.json({ ok: true, id, type });
  } catch (e) {
    console.error('[api-v1 PATCH /:id]', e);
    res.status(500).json({ error: e.message || 'Failed to update initiative' });
  }
}

// ---- /api/v1/initiatives — caller chooses the type ---------------------------------
export const initiativesRouter = express.Router();

function requireType(req, res) {
  const type = resolveType(req.body?.type);
  if (!type) res.status(400).json({ error: 'type is required: "CR" or "Project"' });
  return type;
}

initiativesRouter.post('/list', (req, res) => {
  const type = requireType(req, res);
  if (type) return listInitiatives(req, res, type);
});

initiativesRouter.patch('/:id', (req, res) => {
  const type = requireType(req, res);
  if (type) return updateInitiative(req, res, type);
});

// ---- /api/v1/crs — original CR-only API (type fixed to CR) -------------------------
export const crsRouter = express.Router();
crsRouter.post('/list', (req, res) => listInitiatives(req, res, 'CR'));
crsRouter.patch('/:id', (req, res) => updateInitiative(req, res, 'CR'));
