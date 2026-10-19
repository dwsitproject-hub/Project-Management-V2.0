/**
 * CR (Change Request) task templates and initiative milestone normalization.
 */

export const INITIATIVE_MILESTONES = [
  'Preparation',
  'Business Requirement',
  'Tech Assessment',
  'Planning',
  'Development',
  'Testing',
  'Live (Warranty Period)',
  'Fully Live',
];

/** Old / alternate initiative milestone labels → canonical initiative milestone (7 standard values). */
export const CR_INITIATIVE_MILESTONE_MAP = {
  'user initiate': 'Preparation',
  'cr created': 'Preparation',
  'cr signed sec 2 and 3': 'Preparation',
  'cr signed sec 2': 'Preparation',
  'cr signed sec 3': 'Preparation',
  'fsd': 'Tech Assessment',
  'development': 'Development',
  'changes': 'Development',
  'signed changes': 'Development',
  'development - extended': 'Development',
  'development-extended': 'Development',
  sit: 'Testing',
  uat: 'Testing',
  live: 'Live (Warranty Period)',
  'live (warranty period)': 'Live (Warranty Period)',
  'live (waranty period)': 'Live (Warranty Period)',
  'fully live': 'Fully Live',
};

/**
 * Map a CR initiative's milestone field to a valid INITIATIVE_MILESTONES value.
 */
export function mapCrInitiativeMilestone(raw) {
  if (!raw || typeof raw !== 'string') return 'Preparation';
  const key = raw.trim().toLowerCase();
  const mapped = CR_INITIATIVE_MILESTONE_MAP[key];
  if (mapped) return mapped;
  const exact = INITIATIVE_MILESTONES.find((m) => m.toLowerCase() === key);
  if (exact) return exact;
  return 'Preparation';
}

/** Default CR tasks: name + milestone (same label for both as per product spec). */
export const CR_TASK_DEFINITIONS = [
  { name: 'User Initiate', milestone: 'User Initiate' },
  { name: 'CR Created', milestone: 'CR Created' },
  { name: 'CR Signed sec 2', milestone: 'CR Signed sec 2' },
  { name: 'CR Signed Sec 3', milestone: 'CR Signed Sec 3' },
  { name: 'FSD', milestone: 'FSD' },
  { name: 'Development', milestone: 'Development' },
  { name: 'SIT', milestone: 'SIT' },
  { name: 'UAT', milestone: 'UAT' },
  { name: 'Live (Warranty Period)', milestone: 'Live (Warranty Period)' },
  { name: 'Fully Live', milestone: 'Fully Live' },
];

// CR milestone phase labels (new values shown in UI and distribution)
export const CR_MILESTONE_PHASES = [
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
  'Live (Warranty Period)',
  'Fully Live',
];

/** Legacy CR phase label (pre–warranty split). Accepted on write; normalized on persist. */
export const CR_MILESTONE_LEGACY_LIVE = 'Live';
export const CR_MILESTONE_LIVE_WARRANTY = 'Live (Warranty Period)';
export const CR_MILESTONE_FULLY_LIVE = 'Fully Live';

/** @param {string|null|undefined} value */
export function normalizeCrMilestonePhase(value) {
  if (!value) return value;
  if (value === CR_MILESTONE_LEGACY_LIVE) return CR_MILESTONE_LIVE_WARRANTY;
  if (value === 'Live (Waranty Period)') return CR_MILESTONE_LIVE_WARRANTY;
  return value;
}

/** @param {string|null|undefined} value */
export function isValidCrMilestonePhase(value) {
  if (!value || typeof value !== 'string') return false;
  return CR_MILESTONE_PHASES.includes(value) || value === CR_MILESTONE_LEGACY_LIVE;
}

/**
 * @param {string|null|undefined} rowMilestone
 * @param {string[]} filterValues
 */
export function crMilestoneMatchesFilter(rowMilestone, filterValues) {
  if (!filterValues?.length) return true;
  // Trim the row value too — the CR dashboard counts milestones trimmed.
  const row = normalizeCrMilestonePhase(String(rowMilestone || '').trim());
  return filterValues.some((f) => row === normalizeCrMilestonePhase(String(f || '').trim()));
}

export function isLiveStatus(status) {
  return String(status || '').trim().toLowerCase() === 'live';
}

/** Actual End Date required when Status=Live and Milestone=Fully Live. */
export function requiresCrFullyLiveEndDate(status, milestone) {
  return isLiveStatus(status) && normalizeCrMilestonePhase(milestone) === CR_MILESTONE_FULLY_LIVE;
}

export const CR_IN_PROGRESS_STATUSES = new Set(['ON TRACK', 'AT RISK', 'DELAYED']);

// For migration/backfill convenience (create default CR tasks even if CR is NOT STARTED)
export const CR_BACKFILL_TASK_STATUSES = new Set(['NOT STARTED', ...CR_IN_PROGRESS_STATUSES]);

/**
 * Primary IT PIC id for assignment (single-value field or first of itPicIds).
 */
export function getCrAssigneeIdFromBody(body) {
  const itPicId = body.itPicId;
  if (itPicId && String(itPicId).trim()) return String(itPicId).trim();
  const ids = body.itPicIds;
  if (Array.isArray(ids) && ids.length > 0) return String(ids[0]).trim();
  if (typeof ids === 'string' && ids.trim()) {
    const first = ids.split(',')[0].trim();
    if (first) return first;
  }
  return null;
}

export function getCrAssigneeIdFromInitiative(initiative) {
  if (!initiative) return null;
  if (initiative.itPicId && String(initiative.itPicId).trim()) return String(initiative.itPicId).trim();
  const raw = initiative.itPicIds;
  if (typeof raw === 'string' && raw.trim()) {
    const first = raw.split(',')[0].trim();
    if (first) return first;
  }
  return null;
}
