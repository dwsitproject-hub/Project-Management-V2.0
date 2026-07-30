import express from 'express';
import store from '../store.js';
import crypto from 'crypto';
import { requireAdmin } from '../middleware/auth.js';
import {
  PROJECT_MILESTONE_LIVE_WARRANTY,
  PROJECT_MILESTONE_FULLY_LIVE,
  PROJECT_MILESTONE_LEGACY_LIVE,
  normalizeProjectMilestone,
} from '../projectMilestones.js';
import {
  matchesDepartmentGroup,
  isValidDepartmentGroupKey,
} from '../departmentGroups.js';

const router = express.Router();

const nowIso = () => new Date().toISOString();

function normalizeStatus(s) {
  return String(s || '').trim().toUpperCase();
}

function computePortfolioStatus(projects, crs) {
  const badStatuses = new Set(['AT RISK', 'DELAYED']);
  const hasBadProject = projects.some((p) => badStatuses.has(normalizeStatus(p.status)));
  const hasBadCr = crs.some((c) => badStatuses.has(normalizeStatus(c.status)));
  if (hasBadProject || hasBadCr) return 'RED';

  const onHold = projects.some((p) => normalizeStatus(p.status) === 'ON HOLD') || crs.some((c) => normalizeStatus(c.status) === 'ON HOLD');
  if (onHold) return 'AMBER';

  return 'GREEN';
}

function getMilestoneLabel(m) {
  const v = normalizeProjectMilestone(String(m || '').trim());
  return v || '—';
}

function isLiveWarrantyMilestone(p) {
  const m = normalizeProjectMilestone(p.milestone);
  return m === PROJECT_MILESTONE_LIVE_WARRANTY || p.milestone === PROJECT_MILESTONE_LEGACY_LIVE;
}

function departmentNameById(departments, id) {
  if (!id) return '—';
  const dept = (departments || []).find((d) => d.id === id);
  return dept?.name || '—';
}

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const departmentGroupFilter = String(req.query.departmentGroup || '').trim();
  if (departmentGroupFilter && !isValidDepartmentGroupKey(departmentGroupFilter)) {
    return res.status(400).json({ error: 'Invalid departmentGroup' });
  }

  const data = await store.read();
  const initiatives = data.initiatives || [];
  const tasks = data.tasks || [];
  const departments = data.departments || [];
  let projects = initiatives.filter((i) => i.type === 'Project');
  let crs = initiatives.filter((i) => i.type === 'CR');

  if (departmentGroupFilter) {
    projects = projects.filter((p) =>
      matchesDepartmentGroup(departments, p.departmentId, departmentGroupFilter)
    );
    crs = crs.filter((c) =>
      matchesDepartmentGroup(departments, c.departmentId, departmentGroupFilter)
    );
  }

  const notesRow = (data.managementDashboard || [])[0] || null;
  const storedPortfolioStatus = String(notesRow?.portfolioStatus || '').trim().toUpperCase();
  const portfolioStatus =
    storedPortfolioStatus === 'GREEN' || storedPortfolioStatus === 'AMBER' || storedPortfolioStatus === 'RED'
      ? storedPortfolioStatus
      : 'GREEN';

  // Timeline Progress:
  // - show projects with status On Track / At Risk / Delayed
  // - plus Live projects where Actual End Date happens within this month
  // - exclude Live (Warranty Period) milestone (shown in IT PROJECT LIVE section)
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);

  const parseDate = (s) => {
    if (!s) return null;
    const d = new Date(String(s).slice(0, 10));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const allowedStatuses = new Set(['ON TRACK', 'AT RISK', 'DELAYED']);
  const inProgressProjects = projects.filter((p) => allowedStatuses.has(normalizeStatus(p.status)));

  const liveThisMonth = projects.filter((p) => {
    if (normalizeStatus(p.status) !== 'LIVE') return false;
    const end = parseDate(p.endDate); // Actual End Date
    if (!end) return false;
    return end >= monthStart && end <= monthEnd;
  });

  // % Completion (matches Initiative view logic):
  // - average task status progress if tasks exist
  // - otherwise fallback to initiative status mapping
  const statusToPercent = {
    // Task status values (lowercase)
    'not started': 0,
    'in progress': 50,
    'at risk': 25,
    'cancel': 100,
    'done': 100,
    // Initiative status values (uppercase keys)
    'NOT STARTED': 0,
    'ON HOLD': 0,
    'ON TRACK': 50,
    'AT RISK': 25,
    'DELAYED': 10,
    'LIVE': 100,
    'CANCELLED': 100,
  };
  const percentForTaskStatus = (s) => {
    const k = String(s || '').trim().toLowerCase();
    return statusToPercent[k] ?? 0;
  };
  const percentForInitiativeStatus = (s) => {
    const k = normalizeStatus(s);
    return statusToPercent[k] ?? 0;
  };
  const computePercentCompletion = (initiativeId, initiativeStatus) => {
    const ts = tasks.filter((t) => t.initiativeId === initiativeId);
    if (ts.length > 0) {
      const total = ts.reduce((sum, t) => sum + percentForTaskStatus(t.status), 0);
      return Math.max(0, Math.min(100, Math.round(total / ts.length)));
    }
    return Math.max(0, Math.min(100, percentForInitiativeStatus(initiativeStatus)));
  };

  const timelineProjects = [...inProgressProjects, ...liveThisMonth]
    .filter((p) => !isLiveWarrantyMilestone(p))
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((p) => ({
      id: p.id,
      name: p.name,
      milestone: getMilestoneLabel(p.milestone),
      status: p.status || null,
      priority: p.priority || null,
      percentCompletion: computePercentCompletion(p.id, p.status),
      planStartDate: p.planStartDate || null,
      planEndDate: p.planEndDate || null,
      startDate: p.startDate || null,
      endDate: p.endDate || null,
      createdAt: p.createdAt || null,
      updatedAt: p.updatedAt || null,
    }));

  // IT Project Live (Warranty Period): projects at Live (Warranty Period) milestone
  const itProjectLiveWarranty = projects
    .filter((p) => isLiveWarrantyMilestone(p))
    .slice()
    .sort((a, b) => {
      const ae = parseDate(a.endDate);
      const be = parseDate(b.endDate);
      if (ae && be) return be.getTime() - ae.getTime();
      if (ae) return -1;
      if (be) return 1;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })
    .map((p) => {
      const end = parseDate(p.endDate);
      let liveAgingDays = null;
      if (end) {
        liveAgingDays = Math.floor((today.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
      }
      return {
        id: p.id,
        name: p.name,
        milestone: getMilestoneLabel(p.milestone),
        startDate: p.startDate || null,
        endDate: p.endDate || null,
        liveAgingDays,
        remark: p.remark || null,
      };
    });

  const itProjectFullyLive = projects
    .filter((p) => p.milestone === PROJECT_MILESTONE_FULLY_LIVE)
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((p) => ({
      id: p.id,
      name: p.name,
      department: departmentNameById(departments, p.departmentId),
      startDate: p.startDate || null,
      endDate: p.endDate || null,
      businessImpact: p.businessImpact || null,
    }));

  const itProjectNotStarted = projects
    .filter((p) => normalizeStatus(p.status) === 'NOT STARTED')
    .slice()
    .sort((a, b) => {
      const ap = parseDate(a.planStartDate);
      const bp = parseDate(b.planStartDate);
      if (ap && bp) return ap.getTime() - bp.getTime();
      if (ap) return -1;
      if (bp) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      planStartDate: p.planStartDate || null,
      department: departmentNameById(departments, p.departmentId),
      businessImpact: p.businessImpact || null,
    }));

  // CR funnel: group by CR milestone (phase) instead of fixed buckets.
  const milestoneCounts = new Map();
  crs
    .filter((c) => normalizeStatus(c.status) !== 'CANCELLED')
    .forEach((c) => {
    const key = String(c.milestone || '—').trim() || '—';
    milestoneCounts.set(key, (milestoneCounts.get(key) || 0) + 1);
  });
  const crFunnel = Array.from(milestoneCounts.entries())
    .map(([milestone, count]) => ({ milestone, count }))
    .sort((a, b) => {
      // Keep UI-friendly order for known CR phases, then alpha.
      const preferred = [
        'User Initiate',
        'CR Created',
        'CR Signed sec 2',
        'CR Signed Sec 3',
        'FSD',
        'Development',
        'Changes',
        'Signed Changes',
        'Development - Extended',
        'SIT',
        'UAT',
        'Testing',
        'Live',
      ].map((x) => x.toLowerCase());
      const ai = preferred.indexOf(String(a.milestone).toLowerCase());
      const bi = preferred.indexOf(String(b.milestone).toLowerCase());
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return String(a.milestone).localeCompare(String(b.milestone));
    });

  // High Priority CRs (Top 5):
  // - Priority = P0
  // - not Live/Cancelled
  // - nearest Plan End Date from today (ascending)
  const highPriorityCrs = crs
    .filter((c) => {
      const p = String(c.priority || '').toUpperCase();
      const s = normalizeStatus(c.status);
      return p === 'P0' && s !== 'LIVE' && s !== 'CANCELLED';
    })
    .slice()
    .sort((a, b) => {
      const ad = parseDate(a.planEndDate);
      const bd = parseDate(b.planEndDate);
      const aKey = ad ? Math.abs(ad.getTime() - today.getTime()) : Number.POSITIVE_INFINITY;
      const bKey = bd ? Math.abs(bd.getTime() - today.getTime()) : Number.POSITIVE_INFINITY;
      if (aKey !== bKey) return aKey - bKey;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })
    .slice(0, 5)
    .map((c) => ({
      id: c.id,
      ticket: c.ticket || '',
      name: c.name,
      status: c.status || '',
      priority: c.priority || '',
      planEndDate: c.planEndDate || null,
    }));

  // Risks & blockers: projects + CRs with At Risk/Delayed/On Hold
  const risksBlockers = projects
    .filter((i) => ['AT RISK', 'DELAYED', 'ON HOLD'].includes(normalizeStatus(i.status)))
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 6)
    .map((i) => ({
      id: i.id,
      issue: i.name,
      remark: i.remark || '',
      status: i.status || null,
      type: i.type,
    }));

  res.json({
    portfolioStatus,
    departmentGroupFilter: departmentGroupFilter || null,
    timelineProgress: timelineProjects,
    itProjectLiveWarranty,
    itProjectLived: itProjectLiveWarranty,
    itProjectFullyLive,
    itProjectNotStarted,
    crFunnel,
    highPriorityCrs,
    risksBlockers,
    notes: notesRow
      ? {
          portfolioStatus: portfolioStatus,
          highlights: notesRow.highlights || '',
          criticalAlerts: notesRow.criticalAlerts || '',
          updatedBy: notesRow.updatedBy || null,
          updatedAt: notesRow.updatedAt || null,
        }
      : { portfolioStatus, highlights: '', criticalAlerts: '', updatedBy: null, updatedAt: null },
  });
});

router.put('/notes', async (req, res) => {
  const { highlights, criticalAlerts, portfolioStatus } = req.body || {};
  const data = await store.read();
  if (!data.managementDashboard) data.managementDashboard = [];

  const updatedAt = nowIso();
  const updatedBy = req.user?.id || 'Unknown';
  const status = String(portfolioStatus || '').trim().toUpperCase();
  const normalizedStatus = status === 'GREEN' || status === 'AMBER' || status === 'RED' ? status : 'GREEN';

  if (data.managementDashboard.length === 0) {
    data.managementDashboard.push({
      id: crypto.randomUUID(),
      portfolioStatus: normalizedStatus,
      highlights: String(highlights || ''),
      criticalAlerts: String(criticalAlerts || ''),
      updatedBy,
      updatedAt,
    });
  } else {
    data.managementDashboard[0] = {
      ...data.managementDashboard[0],
      portfolioStatus: normalizedStatus,
      highlights: String(highlights || ''),
      criticalAlerts: String(criticalAlerts || ''),
      updatedBy,
      updatedAt,
    };
  }

  await store.write(data);
  res.json({ ok: true, updatedAt, updatedBy });
});

export default router;

