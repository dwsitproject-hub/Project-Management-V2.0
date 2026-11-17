/**
 * Task Status and Milestone Enums with case-insensitive normalization
 */
import { CR_TASK_DEFINITIONS, CR_MILESTONE_PHASES } from '../crTaskTemplates.js';
import {
  PROJECT_MILESTONES,
  PROJECT_MILESTONE_LIVE_WARRANTY,
  PROJECT_MILESTONE_FULLY_LIVE,
  PROJECT_MILESTONE_LEGACY_LIVE,
} from '../projectMilestones.js';

// Every CR milestone can carry a task: ERP-synced CRs get tasks for CR - Section 1, Configuration,
// Signed Changes, Development - Extended… on demand (routes/erp-integration.js).
const CR_TASK_MILESTONE_VALUES = [...new Set([...CR_TASK_DEFINITIONS.map((t) => t.milestone), ...CR_MILESTONE_PHASES])];
const CR_TASK_MILESTONE_BY_LOWER = Object.fromEntries(
  CR_TASK_MILESTONE_VALUES.map((m) => [m.toLowerCase(), m])
);
const PROJECT_MILESTONE_BY_LOWER = Object.fromEntries(
  PROJECT_MILESTONES.map((m) => [m.toLowerCase(), m])
);

// ========== TASK STATUS ENUM ==========
export const TaskStatus = {
  NOT_STARTED: 'not started',
  IN_PROGRESS: 'in progress',
  AT_RISK: 'at risk',
  CANCELLED: 'cancel',
  DONE: 'done'
};

// Valid status values (for validation)
export const VALID_TASK_STATUSES = Object.values(TaskStatus);

// Mapping aliases to canonical values (case-insensitive)
const STATUS_ALIASES = {
  // NOT_STARTED aliases
  'not started': TaskStatus.NOT_STARTED,
  'notstarted': TaskStatus.NOT_STARTED,
  'not_started': TaskStatus.NOT_STARTED,
  'new': TaskStatus.NOT_STARTED,
  'pending': TaskStatus.NOT_STARTED,
  'to do': TaskStatus.NOT_STARTED,
  'todo': TaskStatus.NOT_STARTED,
  
  // IN_PROGRESS aliases
  'in progress': TaskStatus.IN_PROGRESS,
  'inprogress': TaskStatus.IN_PROGRESS,
  'in_progress': TaskStatus.IN_PROGRESS,
  'in-progress': TaskStatus.IN_PROGRESS,
  'on track': TaskStatus.IN_PROGRESS,
  'ontrack': TaskStatus.IN_PROGRESS,
  'on_track': TaskStatus.IN_PROGRESS,
  'wip': TaskStatus.IN_PROGRESS,
  'working': TaskStatus.IN_PROGRESS,
  'ongoing': TaskStatus.IN_PROGRESS,
  
  // AT_RISK aliases
  'at risk': TaskStatus.AT_RISK,
  'atrisk': TaskStatus.AT_RISK,
  'at_risk': TaskStatus.AT_RISK,
  'at-risk': TaskStatus.AT_RISK,
  'delayed': TaskStatus.AT_RISK,
  'blocked': TaskStatus.AT_RISK,
  'on hold': TaskStatus.AT_RISK,
  'onhold': TaskStatus.AT_RISK,
  'on_hold': TaskStatus.AT_RISK,
  
  // CANCELLED aliases
  'cancel': TaskStatus.CANCELLED,
  'cancelled': TaskStatus.CANCELLED,
  'canceled': TaskStatus.CANCELLED,
  'dropped': TaskStatus.CANCELLED,
  'removed': TaskStatus.CANCELLED,
  'aborted': TaskStatus.CANCELLED,
  
  // DONE aliases
  'done': TaskStatus.DONE,
  'complete': TaskStatus.DONE,
  'completed': TaskStatus.DONE,
  'finished': TaskStatus.DONE,
  'live': TaskStatus.DONE,
  'closed': TaskStatus.DONE
};

/**
 * Normalize a status value to its canonical enum value
 * @param {string} input - The input status value (case-insensitive)
 * @param {string} defaultValue - Default value if input is invalid/empty
 * @returns {string} The normalized status value
 */
export function normalizeStatus(input, defaultValue = TaskStatus.NOT_STARTED) {
  if (!input || typeof input !== 'string') {
    return defaultValue;
  }
  
  const normalized = input.toLowerCase().trim();
  
  if (STATUS_ALIASES[normalized]) {
    return STATUS_ALIASES[normalized];
  }
  
  // If no alias match, check if it's already a valid enum value
  if (VALID_TASK_STATUSES.includes(normalized)) {
    return normalized;
  }
  
  // Return default if no match found
  console.warn(`Invalid task status "${input}" - defaulting to "${defaultValue}"`);
  return defaultValue;
}

/**
 * Validate if a status is valid
 * @param {string} status - The status to validate
 * @returns {boolean} True if valid
 */
export function isValidStatus(status) {
  if (!status || typeof status !== 'string') return false;
  const normalized = status.toLowerCase().trim();
  return STATUS_ALIASES[normalized] !== undefined || VALID_TASK_STATUSES.includes(normalized);
}


// ========== MILESTONE ENUM ==========
export const Milestone = {
  BUSINESS_REQUIREMENT: 'Business Requirement',
  TECH_ASSESSMENT: 'Tech Assessment',
  PLANNING: 'Planning',
  DEVELOPMENT: 'Development',
  TESTING: 'Testing',
  LIVE_PREPARATION: 'Live Preparation'
};

// Valid milestone values — task workflow, project initiative phases, CR phase labels
export const VALID_MILESTONES = [
  ...Object.values(Milestone),
  ...PROJECT_MILESTONES,
  PROJECT_MILESTONE_LEGACY_LIVE,
  ...CR_TASK_MILESTONE_VALUES,
];

// Mapping aliases to canonical values (case-insensitive)
const MILESTONE_ALIASES = {
  // BUSINESS_REQUIREMENT aliases
  'business requirement': Milestone.BUSINESS_REQUIREMENT,
  'businessrequirement': Milestone.BUSINESS_REQUIREMENT,
  'business_requirement': Milestone.BUSINESS_REQUIREMENT,
  'business-requirement': Milestone.BUSINESS_REQUIREMENT,
  'br': Milestone.BUSINESS_REQUIREMENT,
  'brd': Milestone.BUSINESS_REQUIREMENT,
  'requirements': Milestone.BUSINESS_REQUIREMENT,
  'requirement': Milestone.BUSINESS_REQUIREMENT,
  
  // TECH_ASSESSMENT aliases
  'tech assessment': Milestone.TECH_ASSESSMENT,
  'techassessment': Milestone.TECH_ASSESSMENT,
  'tech_assessment': Milestone.TECH_ASSESSMENT,
  'tech-assessment': Milestone.TECH_ASSESSMENT,
  'technical assessment': Milestone.TECH_ASSESSMENT,
  'ta': Milestone.TECH_ASSESSMENT,
  'assessment': Milestone.TECH_ASSESSMENT,
  
  // PLANNING aliases
  'planning': Milestone.PLANNING,
  'plan': Milestone.PLANNING,
  'design': Milestone.PLANNING,
  
  // DEVELOPMENT aliases
  'development': Milestone.DEVELOPMENT,
  'dev': Milestone.DEVELOPMENT,
  'develop': Milestone.DEVELOPMENT,
  'coding': Milestone.DEVELOPMENT,
  'implementation': Milestone.DEVELOPMENT,
  'build': Milestone.DEVELOPMENT,
  
  // TESTING aliases
  'testing': Milestone.TESTING,
  'test': Milestone.TESTING,
  'qa': Milestone.TESTING,
  'qc': Milestone.TESTING,
  'sit': Milestone.TESTING,
  'uat': Milestone.TESTING,
  'user acceptance testing': Milestone.TESTING,
  'system integration testing': Milestone.TESTING,
  
  // LIVE_PREPARATION aliases (do not use bare "live" — reserved for CR task phase "Live")
  'live preparation': Milestone.LIVE_PREPARATION,
  'livepreparation': Milestone.LIVE_PREPARATION,
  'live_preparation': Milestone.LIVE_PREPARATION,
  'live-preparation': Milestone.LIVE_PREPARATION,
  'go live': Milestone.LIVE_PREPARATION,
  'golive': Milestone.LIVE_PREPARATION,
  'go-live': Milestone.LIVE_PREPARATION,
  'deployment': Milestone.LIVE_PREPARATION,
  'release': Milestone.LIVE_PREPARATION,
  'launch': Milestone.LIVE_PREPARATION,
  'production': Milestone.LIVE_PREPARATION,

  // Project initiative milestones (canonical labels)
  preparation: 'Preparation',
  'live (warranty period)': PROJECT_MILESTONE_LIVE_WARRANTY,
  'live (waranty period)': PROJECT_MILESTONE_LIVE_WARRANTY,
  'fully live': PROJECT_MILESTONE_FULLY_LIVE,
};

/**
 * Normalize a milestone value to its canonical enum value
 * @param {string} input - The input milestone value (case-insensitive)
 * @param {string} defaultValue - Default value if input is invalid/empty (null for optional)
 * @returns {string|null} The normalized milestone value or null if empty/invalid
 */
export function normalizeMilestone(input, defaultValue = null) {
  if (!input || typeof input !== 'string') {
    return defaultValue;
  }
  
  const normalized = input.toLowerCase().trim();
  
  // Allow empty/none values
  if (normalized === '' || normalized === 'none' || normalized === 'null') {
    return null;
  }

  // CR workflow task milestones (exact labels) take precedence over generic aliases
  if (CR_TASK_MILESTONE_BY_LOWER[normalized]) {
    return CR_TASK_MILESTONE_BY_LOWER[normalized];
  }

  // Project initiative milestones (Preparation → Fully Live)
  if (PROJECT_MILESTONE_BY_LOWER[normalized]) {
    return PROJECT_MILESTONE_BY_LOWER[normalized];
  }
  
  if (MILESTONE_ALIASES[normalized]) {
    return MILESTONE_ALIASES[normalized];
  }

  // If no alias match, check if it matches any valid value (case-insensitive)
  for (const validMilestone of VALID_MILESTONES) {
    if (validMilestone.toLowerCase() === normalized) {
      return validMilestone;
    }
  }
  
  // Return default (null) if no match found - milestone is optional
  console.warn(`Invalid milestone "${input}" - defaulting to null`);
  return defaultValue;
}

/**
 * Validate if a milestone is valid (or null/empty which is allowed)
 * @param {string} milestone - The milestone to validate
 * @returns {boolean} True if valid or empty
 */
export function isValidMilestone(milestone) {
  if (!milestone || milestone === 'none') return true; // Milestone is optional
  if (typeof milestone !== 'string') return false;
  const normalized = milestone.toLowerCase().trim();
  return (
    MILESTONE_ALIASES[normalized] !== undefined ||
    PROJECT_MILESTONE_BY_LOWER[normalized] !== undefined ||
    CR_TASK_MILESTONE_BY_LOWER[normalized] !== undefined ||
    VALID_MILESTONES.some((m) => m.toLowerCase() === normalized)
  );
}

// Display labels for frontend (maps internal value to display label)
export const STATUS_DISPLAY_LABELS = {
  [TaskStatus.NOT_STARTED]: 'Not Started',
  [TaskStatus.IN_PROGRESS]: 'In Progress',
  [TaskStatus.AT_RISK]: 'At Risk',
  [TaskStatus.CANCELLED]: 'Cancelled',
  [TaskStatus.DONE]: 'Done'
};

export const MILESTONE_DISPLAY_LABELS = {
  [Milestone.BUSINESS_REQUIREMENT]: 'Business Requirement',
  [Milestone.TECH_ASSESSMENT]: 'Tech Assessment',
  [Milestone.PLANNING]: 'Planning',
  [Milestone.DEVELOPMENT]: 'Development',
  [Milestone.TESTING]: 'Testing',
  [Milestone.LIVE_PREPARATION]: 'Live Preparation',
  Preparation: 'Preparation',
  [PROJECT_MILESTONE_LIVE_WARRANTY]: PROJECT_MILESTONE_LIVE_WARRANTY,
  [PROJECT_MILESTONE_FULLY_LIVE]: PROJECT_MILESTONE_FULLY_LIVE,
};

export default {
  TaskStatus,
  Milestone,
  VALID_TASK_STATUSES,
  VALID_MILESTONES,
  normalizeStatus,
  normalizeMilestone,
  isValidStatus,
  isValidMilestone,
  STATUS_DISPLAY_LABELS,
  MILESTONE_DISPLAY_LABELS
};
