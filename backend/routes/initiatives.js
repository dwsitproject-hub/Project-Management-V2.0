import express from 'express';
import store from '../store.js';
import crypto from 'crypto';
import { sendCRCreationEmail } from '../services/email.js';
import { initiativeTriggersCrCreationEmail } from '../services/cr-email-eligibility.js';
import fs from 'fs/promises';
import {
  CR_TASK_DEFINITIONS,
  getCrAssigneeIdFromBody,
} from '../crTaskTemplates.js';
import {
  normalizeCrMilestonePhase,
  isValidCrMilestonePhase,
  crMilestoneMatchesFilter,
  requiresCrFullyLiveEndDate as crRequiresFullyLiveEndDate,
} from '../crTaskTemplates.js';
import {
  PROJECT_MILESTONES,
  normalizeProjectMilestone,
  isValidProjectMilestone,
  projectMilestoneMatchesFilter,
} from '../projectMilestones.js';

const router = express.Router();

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

function requiresCrFullyLiveEndDate(type, status, milestone) {
  return type === 'CR' && crRequiresFullyLiveEndDate(status, milestone);
}

// Generate ticket number for CR in format: CRDDMMYYYYRunningNumber
// Example: CR01012025001 (CR + 01/01/2025 + 001)
async function generateCRTicketNumber(data) {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const datePrefix = `${dd}${mm}${yyyy}`;
  
  // Find all CRs created today with tickets matching the pattern
  const todayCRs = (data.initiatives || []).filter(i => {
    if (i.type !== 'CR' || !i.ticket) return false;
    // Check if ticket matches pattern CRDDMMYYYYNNN
    const match = i.ticket.match(/^CR(\d{8})(\d+)$/);
    if (!match) return false;
    return match[1] === datePrefix; // Same date
  });
  
  // Find the highest running number for today
  let maxRunningNumber = 0;
  todayCRs.forEach(cr => {
    const match = cr.ticket.match(/^CR\d{8}(\d+)$/);
    if (match) {
      const runningNum = parseInt(match[1], 10);
      if (runningNum > maxRunningNumber) {
        maxRunningNumber = runningNum;
      }
    }
  });
  
  // Increment for the new CR
  const nextRunningNumber = maxRunningNumber + 1;
  const runningNumberStr = String(nextRunningNumber).padStart(3, '0');
  
  return `CR${datePrefix}${runningNumberStr}`;
}

function validateCommon(body) {
  const required = [
    'type','name','description','priority','businessOwnerId','departmentId','status','milestone'
  ];
  // businessImpact is required for Project, optional for CR
  if (body.type === 'Project' && !body.businessImpact) {
    return 'Missing required field: businessImpact';
  }
  // itPicId is now optional (can use itPicIds instead)
  // But at least one of itPicId or itPicIds must be provided
  if (!body.itPicId && (!body.itPicIds || (Array.isArray(body.itPicIds) && body.itPicIds.length === 0))) {
    return 'Missing required field: IT PIC (itPicId or itPicIds)';
  }
  // Business Users is required
  if (!body.businessUserIds || (Array.isArray(body.businessUserIds) && body.businessUserIds.length === 0)) {
    return 'Missing required field: businessUserIds';
  }
  // IT PM is required for Projects, optional for CRs
  if (body.type === 'Project' && !body.itPmId) {
    return 'Missing required field: itPmId';
  }
  // IT Manager is required
  if (!body.itManagerIds || (Array.isArray(body.itManagerIds) && body.itManagerIds.length === 0)) {
    return 'Missing required field: itManagerIds';
  }
  // Plan Start Date is required
  if (!body.planStartDate || (typeof body.planStartDate === 'string' && body.planStartDate.trim() === '')) {
    return 'Missing required field: planStartDate';
  }
  for (const key of required) {
    if (!body[key] || (typeof body[key] === 'string' && body[key].trim() === '')) {
      return `Missing required field: ${key}`;
    }
  }
  if (!['Project','CR'].includes(body.type)) return 'Invalid type';
  if (!['P0','P1','P2'].includes(body.priority)) return 'Invalid priority';
  const statuses = ['Not Started','On Hold','On Track','At Risk','Delayed','Live','Cancelled'];
  if (!statuses.includes(body.status)) return 'Invalid status';
  // Milestone validation depends on type:
  // - Project: canonical milestone list
  // - CR: store CR phase directly in `milestone` (no extra column)
  if (body.type === 'Project') {
    if (!isValidProjectMilestone(body.milestone)) return 'Invalid milestone';
  } else if (body.type === 'CR') {
    if (!isValidCrMilestonePhase(body.milestone)) return 'Invalid CR milestone phase';
  }

  // Business rule: when CR is Live + Fully Live milestone, Actual End Date is required
  if (
    requiresCrFullyLiveEndDate(body.type, body.status, body.milestone) &&
    (!body.endDate || (typeof body.endDate === 'string' && body.endDate.trim() === ''))
  ) {
    return 'Missing required field: endDate';
  }
  return null;
}

// Multi-value id fields come from store.read() as arrays; older data may be CSV strings.
function toIdList(raw) {
  if (Array.isArray(raw)) return raw.map((id) => String(id).trim()).filter(Boolean);
  return String(raw || '').split(',').map((id) => id.trim()).filter(Boolean);
}

// Drill-down modals on the dashboards call this endpoint with the clicked value, so its
// matching must use the SAME normalization the dashboards count with (trim/upper-case,
// CR milestone aliases), otherwise a number and its detail list disagree.
router.get('/', async (req, res) => {
  const { q, type, status, milestone, crMilestonePhase, priority, departmentId, itPicId, itPmId, businessOwnerId, active, systemImpactedId, itManagerId, limit } = req.query;
  const data = await store.read();
  let rows = data.initiatives;
  
  // Helper function to parse comma-separated values (URL decoded)
  const parseMultiValue = (value) => {
    if (!value) return null;
    // Decode URL encoding (e.g., %20 for spaces) before splitting
    // Express may or may not decode automatically, so we handle both cases
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch (e) {
      // If already decoded or invalid encoding, use as-is
      decoded = value;
    }
    return decoded.split(',').map(v => v.trim()).filter(v => v);
  };
  
  if (q) {
    const qLower = String(q).toLowerCase();
    rows = rows.filter(r => 
      (r.name || '').toLowerCase().includes(qLower) ||
      (r.description || '').toLowerCase().includes(qLower) ||
      (r.ticket || '').toLowerCase().includes(qLower)
    );
  }
  if (type) rows = rows.filter(r => r.type === type);
  if (active === 'true') rows = rows.filter(r => r.status && r.status.toUpperCase() !== 'NOT STARTED');
  
  // Status: case-insensitive and whitespace-trimmed (as the dashboards count)
  const statusValues = parseMultiValue(status);
  if (statusValues && statusValues.length > 0) {
    const wanted = new Set(statusValues.map((s) => s.toUpperCase()));
    rows = rows.filter((r) => wanted.has(String(r.status || '').trim().toUpperCase()));
  }

  // Milestone: CR phases and Project milestones have different vocabularies and legacy
  // aliases (e.g. CR 'Live' / 'Live (Waranty Period)'), so match each with its own rules.
  const milestoneValues = parseMultiValue(milestone);
  if (milestoneValues && milestoneValues.length > 0) {
    rows = rows.filter((r) =>
      r.type === 'CR'
        ? crMilestoneMatchesFilter(r.milestone, milestoneValues)
        : projectMilestoneMatchesFilter(r.milestone, milestoneValues)
    );
  }

  // Backward compatibility: older clients may send `crMilestonePhase`.
  // Since we now store CR phase directly in `milestone`, treat it as an alias for `milestone` when type=CR.
  const crPhaseValues = parseMultiValue(crMilestonePhase);
  if (crPhaseValues && crPhaseValues.length > 0) {
    rows = rows.filter(r => r.type === 'CR' && crPhaseValues.includes(r.milestone));
  }
  
  // Priority: case-insensitive and trimmed (dashboards count 'p1' / 'P1 ' as P1)
  const priorityValues = parseMultiValue(priority);
  if (priorityValues && priorityValues.length > 0) {
    const wanted = new Set(priorityValues.map((p) => p.toUpperCase()));
    rows = rows.filter((r) => wanted.has(String(r.priority || '').trim().toUpperCase()));
  }

  // Department: '__none__' (or the dashboards' 'N/A' label) selects initiatives with no department
  const departmentIdValues = parseMultiValue(departmentId);
  if (departmentIdValues && departmentIdValues.length > 0) {
    const isNone = (v) => v === '__none__' || v === 'N/A';
    const wantNone = departmentIdValues.some(isNone);
    const ids = departmentIdValues.filter((v) => !isNone(v));
    rows = rows.filter((r) => (wantNone && !r.departmentId) || ids.includes(r.departmentId));
  }

  // IT Manager (multi-value, OR logic; initiative.itManagerIds is an array/CSV)
  const itManagerIdValues = parseMultiValue(itManagerId);
  if (itManagerIdValues && itManagerIdValues.length > 0) {
    rows = rows.filter((r) => {
      const ids = toIdList(r.itManagerIds);
      return itManagerIdValues.some((sel) => ids.includes(sel));
    });
  }
  
  // Multi-value filters for IT PIC and Business Owner (OR logic)
  const itPicIdValues = parseMultiValue(itPicId);
  if (itPicIdValues && itPicIdValues.length > 0) {
    rows = rows.filter(r => itPicIdValues.includes(r.itPicId));
  }
  
  const businessOwnerIdValues = parseMultiValue(businessOwnerId);
  if (businessOwnerIdValues && businessOwnerIdValues.length > 0) {
    rows = rows.filter(r => businessOwnerIdValues.includes(r.businessOwnerId));
  }

  // Multi-value filter for IT PM (OR logic, case-sensitive on id)
  const itPmIdValues = parseMultiValue(itPmId);
  if (itPmIdValues && itPmIdValues.length > 0) {
    rows = rows.filter(r => itPmIdValues.includes(r.itPmId));
  }

  // Multi-value filter for System Impacted (initiative.systemImpactedIds includes any selected id)
  const systemImpactedValues = parseMultiValue(systemImpactedId);
  if (systemImpactedValues && systemImpactedValues.length > 0) {
    rows = rows.filter((r) => {
      const raw = r.systemImpactedIds || [];
      const ids = Array.isArray(raw)
        ? raw
        : String(raw).split(',').map(v => v.trim()).filter(Boolean);
      return systemImpactedValues.some((sel) => ids.includes(sel));
    });
  }
  
  rows = rows.sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||''));

  // Include CR data for CR initiatives (index once instead of a linear find per row)
  if (type === 'CR') {
    const crByInitiative = new Map((data.changeRequests || []).map((cr) => [cr.initiativeId, cr]));
    rows = rows.map((initiative) => ({ ...initiative, cr: crByInitiative.get(initiative.id) }));
  }

  // List pages keep the historical 500-row cap by default. Dashboards and drill-down
  // modals pass limit=0 (or limit=all) to get EVERY matching row — the silent cap
  // otherwise makes their counts and detail lists disagree once there are >500 rows.
  const cap = limit === undefined ? 500 : Number(limit);
  res.json(cap > 0 ? rows.slice(0, cap) : rows);
});

/** Last N change-history entries for initiatives of a given type (Project | CR). */
router.get('/recent-activity', async (req, res) => {
  const { type } = req.query;
  const limitRaw = parseInt(String(req.query.limit || '20'), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;
  if (type !== 'Project' && type !== 'CR') {
    return res.status(400).json({ error: 'Query parameter "type" must be Project or CR' });
  }
  const data = await store.read();
  const allowedIds = new Set(
    (data.initiatives || []).filter((i) => i.type === type).map((i) => i.id)
  );
  const byId = Object.fromEntries((data.initiatives || []).map((i) => [i.id, i]));
  const items = (data.changeHistory || [])
    .filter((h) => h.initiativeId && allowedIds.has(h.initiativeId))
    .map((h) => {
      const init = byId[h.initiativeId];
      return {
        id: h.id,
        initiativeId: h.initiativeId,
        initiativeName: init?.name || '',
        initiativeTicket: init?.ticket || '',
        timestamp: h.timestamp,
        changedBy: h.changedBy,
        changes: Array.isArray(h.changes) ? h.changes : [],
      };
    })
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, limit);
  res.json(items);
});

router.get('/:id', async (req, res) => {
  const data = await store.read();
  const i = data.initiatives.find(x => x.id === req.params.id);
  if (!i) return res.status(404).json({ error: 'Not found' });
  
  const result = { ...i };
  if (i.type === 'CR') {
    const cr = data.changeRequests.find(x => x.initiativeId === i.id) || null;
    result.cr = cr;
  }
  
  // Add documents
  const documents = (data.documents || []).filter(d => d.initiativeId === i.id);
  result.documents = documents;
  
  // Add change history
  const history = (data.changeHistory || []).filter(h => h.initiativeId === i.id);
  console.log(`[ChangeHistory] initiative ${i.id} history count: ${history.length}`);
  result.changeHistory = history;
  
  res.json(result);
});

router.post('/', async (req, res) => {
  const error = validateCommon(req.body);
  if (error) return res.status(400).json({ error });
  const id = uuid();
  const createdAt = now();
  const updatedAt = createdAt;
  const {
    type,name,ticket,description,businessImpact,priority,businessOwnerId,businessUserIds,departmentId,itPicId,itPicIds,itPmId,itManagerIds,systemImpactedIds,status,milestone,startDate,endDate,planStartDate,planEndDate,remark,documentationLink
  } = req.body;
  const data = await store.read();
  
  // Convert arrays to comma-separated strings for storage
  const businessUserIdsStr = Array.isArray(businessUserIds) ? businessUserIds.join(',') : (businessUserIds || null);
  const itPicIdsStr = Array.isArray(itPicIds) ? itPicIds.join(',') : (itPicIds || null);
  const itManagerIdsStr = Array.isArray(itManagerIds) ? itManagerIds.join(',') : (itManagerIds || null);
  const systemImpactedIdsStr = Array.isArray(systemImpactedIds) ? systemImpactedIds.join(',') : (systemImpactedIds || null);
  
  // Use itPicIds if provided, otherwise fall back to itPicId for backward compatibility
  const finalItPicIds = itPicIdsStr || (itPicId ? itPicId : null);
  
  // Generate ticket number for CR if not provided
  let finalTicket = ticket || null;
  if (type === 'CR' && !finalTicket) {
    finalTicket = await generateCRTicketNumber(data);
  }

  const finalMilestone =
    type === 'Project' ? normalizeProjectMilestone(milestone) : normalizeCrMilestonePhase(milestone);
  
  data.initiatives.push({ 
    id,type,name,ticket: finalTicket,description,businessImpact,priority,
    businessOwnerId,businessUserIds: businessUserIdsStr,
    departmentId,
    itPicId: itPicId || null, // Keep for backward compatibility
    itPicIds: finalItPicIds,
    itPmId: itPmId || null,
    itManagerIds: itManagerIdsStr,
    systemImpactedIds: systemImpactedIdsStr,
    status,milestone: finalMilestone,
    crMilestonePhase: null,
    startDate,endDate: endDate||null,planStartDate: planStartDate||null,planEndDate: planEndDate||null,remark: remark||null,documentationLink: documentationLink||null, 
    createdAt, updatedAt 
  });
  if (type === 'CR') {
    const cr = req.body.cr || {};
    data.changeRequests.push({
      initiativeId: id,
      crSubmissionStart: null,
      crSubmissionEnd: null,
      developmentStart: cr.developmentStart || null,
      developmentEnd: cr.developmentEnd || null,
      sitStart: cr.sitStart || null,
      sitEnd: cr.sitEnd || null,
      uatStart: cr.uatStart || null,
      uatEnd: cr.uatEnd || null,
      liveDate: cr.liveDate || null
    });
  }
  
  // Auto-create tasks: CR workflow tasks (IT PIC) or Project milestone tasks
  if (!data.tasks) data.tasks = [];
  if (type === 'CR') {
    const assigneeId = getCrAssigneeIdFromBody(req.body);
    CR_TASK_DEFINITIONS.forEach(({ name, milestone }) => {
      data.tasks.push({
        id: uuid(),
        initiativeId: id,
        name,
        description: null,
        startDate: null,
        endDate: null,
        assigneeId,
        status: 'not started',
        milestone,
        createdAt,
        updatedAt: null,
      });
    });
  } else {
    PROJECT_MILESTONES.forEach((m) => {
      data.tasks.push({
        id: uuid(),
        initiativeId: id,
        name: `${m} Task`,
        description: `Task for ${m} milestone`,
        startDate: null,
        endDate: null,
        assigneeId: null,
        status: 'Not Started',
        milestone: m,
        createdAt,
        updatedAt: null,
      });
    });
  }
  
  await store.write(data);

  // Send email notification for new CR creation only when System Impacted includes SAP FICO or SAP NON FICO
  // Note: Email will be sent when documents are uploaded (if within 10 minutes)
  // If no documents are uploaded within 10 minutes, email will be sent via delayed check
  if (type === 'CR') {
    const createdInitiative = data.initiatives.find((i) => i.id === id);
    const emailEligible =
      createdInitiative && initiativeTriggersCrCreationEmail(data, createdInitiative);

    if (emailEligible) {
      console.log(`[CR CREATION] New CR created (SAP email eligible): ${name} (ID: ${id})`);
      const emailFlag = `cr_email_pending_${id}`;
      global[emailFlag] = {
        initiativeId: id,
        createdAt: new Date(),
        sent: false,
      };

      setTimeout(async () => {
        try {
          const flag = global[emailFlag];
          if (flag && !flag.sent) {
            console.log(
              `[CR CREATION] No documents uploaded within 10 minutes, sending email without documents...`
            );
            const currentData = await store.read();
            const initiative = currentData.initiatives.find((i) => i.id === id);
            if (
              initiative &&
              initiative.type === 'CR' &&
              initiativeTriggersCrCreationEmail(currentData, initiative)
            ) {
              const userLookups = currentData.users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email || null,
              }));

              const documents = (currentData.documents || []).filter((d) => d.initiativeId === id);

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

              await sendCRCreationEmail(crData, userLookups, documents);
              flag.sent = true;
            }
            delete global[emailFlag];
          }
        } catch (error) {
          console.error('[EMAIL ERROR] Error sending delayed CR creation email:', error);
        }
      }, 10 * 60 * 1000); // 10 minutes
    } else {
      console.log(`[CR CREATION] New CR created (no SAP FICO / SAP NON FICO email): ${name} (ID: ${id})`);
    }
  }
  
  res.status(201).json({ id });
});

router.put('/:id', async (req, res) => {
  try {
  const data = await store.read();
  const idx = data.initiatives.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  
  const initiative = data.initiatives[idx];
  const changes = [];
  const updatedAt = now();
  const allowed = ['name','ticket','description','businessImpact','priority','businessOwnerId','businessUserIds','departmentId','itPicId','itPicIds','itPmId','itManagerIds','systemImpactedIds','status','milestone','startDate','endDate','planStartDate','planEndDate','remark','documentationLink'];
  
  // Track changes and update fields
  for (const k of allowed) {
    // Check if field exists in request body (including null values)
    if (k in req.body) {
      let newValue = req.body[k];

      if (k === 'milestone') {
        newValue =
          initiative.type === 'Project'
            ? normalizeProjectMilestone(newValue)
            : normalizeCrMilestonePhase(newValue);
      }
      
      // Convert arrays to comma-separated strings for storage
      if ((k === 'businessUserIds' || k === 'itPicIds' || k === 'itManagerIds' || k === 'systemImpactedIds') && Array.isArray(newValue)) {
        newValue = newValue.length > 0 ? newValue.join(',') : null;
      }
      
      // Handle itPicIds: use itPicIds if provided, otherwise keep existing or use itPicId
      if (k === 'itPicIds' && !newValue && req.body.itPicId) {
        newValue = req.body.itPicId;
      }
      
      // Normalize values for comparison (handle null, undefined, empty string)
      // For array fields (comma-separated strings), normalize by sorting and trimming
      const isArrayField = k === 'businessUserIds' || k === 'itPicIds' || k === 'itManagerIds' || k === 'systemImpactedIds';
      
      let oldVal, newVal;
      if (isArrayField) {
        // For array fields, parse, sort, and compare as sorted arrays
        const parseArray = (val) => {
          if (val == null || val === '') return [];
          if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(v => v).sort();
          return String(val).split(',').map(v => v.trim()).filter(v => v).sort();
        };
        const oldArray = parseArray(initiative[k]);
        const newArray = parseArray(newValue);
        oldVal = oldArray.join(',');
        newVal = newArray.join(',');
        
        // Debug logging for array fields
        console.log(`[Change Tracking] Field: ${k}`);
        console.log(`  Old value (raw): ${JSON.stringify(initiative[k])}`);
        console.log(`  New value (raw): ${JSON.stringify(newValue)}`);
        console.log(`  Old array: ${JSON.stringify(oldArray)}`);
        console.log(`  New array: ${JSON.stringify(newArray)}`);
        console.log(`  Old normalized: "${oldVal}"`);
        console.log(`  New normalized: "${newVal}"`);
        console.log(`  Changed: ${oldVal !== newVal}`);
      } else {
        // For regular fields, convert to strings and trim
        oldVal = initiative[k] == null ? '' : String(initiative[k]).trim();
        newVal = newValue == null ? '' : String(newValue).trim();

        // Special handling for status: treat case-only differences as no change
        if (k === 'status') {
          const oldCmp = oldVal.toLowerCase();
          const newCmp = newVal.toLowerCase();
          if (oldCmp === newCmp) {
            // Normalize stored value but don't create a change-log entry
            initiative[k] = newValue;
            continue;
          }
        }
      }
      
      if (oldVal !== newVal) {
        console.log(`[Change Tracking] Detected change for ${k}: "${oldVal}" -> "${newVal}"`);
        changes.push({
          field: k,
          oldValue: initiative[k] || null,
          newValue: newValue || null,
          changedAt: updatedAt,
          changedBy: req.body.changedBy || 'Unknown'
        });
        initiative[k] = newValue;
      }
    }
  }
  
  initiative.updatedAt = updatedAt;

  // Enforce business rule on update as well:
  // Actual End Date required when CR Status=Live and Milestone=Fully Live
  if (
    requiresCrFullyLiveEndDate(initiative.type, initiative.status, initiative.milestone) &&
    (!initiative.endDate || String(initiative.endDate).trim() === '')
  ) {
    return res.status(400).json({
      error: 'Missing required field: endDate (required when Status is Live and Milestone is Fully Live)',
    });
  }

  if (initiative.type === 'CR' && initiative.milestone && !isValidCrMilestonePhase(initiative.milestone)) {
    return res.status(400).json({ error: 'Invalid CR milestone phase' });
  }
  
  // Track CR changes
  if (initiative.type === 'CR' && req.body.cr) {
    let cr = data.changeRequests.find(x => x.initiativeId === req.params.id);
    if (!cr) {
      cr = { initiativeId: req.params.id };
      data.changeRequests.push(cr);
    }
    if (cr) {
      const keys = ['crSubmissionStart','crSubmissionEnd','developmentStart','developmentEnd','sitStart','sitEnd','uatStart','uatEnd','liveDate'];
      for (const k of keys) {
        if (k in req.body.cr && cr[k] !== req.body.cr[k]) {
          changes.push({
            field: `cr.${k}`,
            oldValue: cr[k],
            newValue: req.body.cr[k],
            changedAt: updatedAt,
            changedBy: req.body.changedBy || 'Unknown'
          });
          cr[k] = req.body.cr[k];
        }
      }
    }
  }
  
  // Store changes
  if (changes.length > 0) {
    if (!data.changeHistory) data.changeHistory = [];
    console.log(`[Change Tracking] Saving ${changes.length} change(s) for initiative ${req.params.id}`);
    data.changeHistory.push({
      id: uuid(),
      initiativeId: req.params.id,
      changes,
      timestamp: updatedAt,
      changedBy: req.body.changedBy || 'Unknown'
    });
  }
  
  await store.write(data);
  res.json({ ok: true, changesCount: changes.length });
  } catch (e) {
    console.error('[initiatives PUT] Failed to save:', e);
    res.status(500).json({ error: e.message || 'Failed to save initiative' });
  }
});

router.delete('/:id', async (req, res) => {
  const data = await store.read();
  const before = data.initiatives.length;
  data.initiatives = data.initiatives.filter(x => x.id !== req.params.id);
  data.changeRequests = data.changeRequests.filter(x => x.initiativeId !== req.params.id);
  await store.write(data);
  res.json({ ok: true, deleted: before - data.initiatives.length });
});

export default router;

