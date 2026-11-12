// ERP CR -> PM value mappings (docs/ERP-CR-INTEGRATION-DESIGN.md §3–§4, from the
// "CR System Integration Workbook"). Pure functions: no store access, so they are easy
// to test (tests/erp-cr-mapper.test.js).

/** Lower-case, tabs/repeated spaces collapsed, en/em dashes -> "-". */
export function normKey(v) {
  return String(v ?? '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Workbook "Status" tab. On Hold / At Risk / Not Started are PM-only.
const STATUS_MAP = {
  'in progress': 'On Track',
  delayed: 'Delayed',
  delated: 'Delayed', // spelling used in the workbook
  completed: 'Live',
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
};

/** ERP status -> PM status, or null when unknown. */
export function mapStatus(erpStatus) {
  return STATUS_MAP[normKey(erpStatus)] || null;
}

// Workbook "Priority" tab.
const PRIORITY_MAP = { high: 'P0', medium: 'P1', low: 'P2' };

/** ERP priority -> PM priority, or null when unknown / not set yet. */
export function mapPriority(erpPriority) {
  return PRIORITY_MAP[normKey(erpPriority)] || null;
}

// Workbook "Milestone" tab: (segment, stage) -> PM CR milestone. Development and SIT /
// SIT -> SIT was confirmed on 11 Nov 2026 (the workbook row said Development).
const MILESTONE_ROWS = [
  ['Preparation', 'User Initiation', 'User Initiate'],
  ['Preparation', 'User Initation', 'User Initiate'], // workbook spelling
  ['Preparation', 'CR Creation', 'CR Created'],
  ['Preparation', 'CR Signed - Section 2', 'CR Signed sec 2'],
  ['Preparation', 'CR Signed - Section 3', 'CR Signed Sec 3'],
  ['FSD Creation & Approval', 'FSD Creation', 'FSD'],
  ['FSD Creation & Approval', 'Developer Review', 'FSD'],
  ['FSD Creation & Approval', 'FSD Approval', 'FSD'],
  ['Development and SIT', 'Development', 'Development'],
  ['Development and SIT', 'SIT', 'SIT'],
  ['Development and SIT', 'Extended Development', 'Development - Extended'],
  ['Development and SIT', 'Extended SIT', 'SIT'],
  ['Development and SIT', 'Update FSD Change Request', 'Signed Changes'],
  ['Development and SIT', 'Extended Developer Review', 'SIT'],
  ['GO-Live', 'GO-LIVE', 'Live (Warranty Period)'],
];
const MILESTONE_MAP = new Map(MILESTONE_ROWS.map(([seg, stage, m]) => [`${normKey(seg)}|${normKey(stage)}`, m]));
const SEGMENT_WIDE = { uat: 'UAT' }; // every stage of the UAT segment -> UAT

/** All (segment, stage) pairs PM understands, for the API docs / error messages. */
export const KNOWN_SEGMENTS = ['Preparation', 'FSD Creation & Approval', 'Development and SIT', 'UAT', 'GO-Live'];

/** ERP (segment, stage) -> PM CR milestone, or null when the pair is not in the mapping. */
export function mapMilestone(segment, stage) {
  const seg = normKey(segment);
  if (SEGMENT_WIDE[seg]) return SEGMENT_WIDE[seg];
  return MILESTONE_MAP.get(`${seg}|${normKey(stage)}`) || null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** ERP rich text (HTML) -> plain text with line breaks kept. PM shows descriptions as text. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const CR_NAME_MAX = 120;

/** CR Name: the Change Request text on one line, cut to 120 characters ("…" when cut). */
export function crNameFrom(text) {
  const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= CR_NAME_MAX) return oneLine;
  return `${oneLine.slice(0, CR_NAME_MAX - 1).trimEnd()}…`;
}

/**
 * A date or timestamp from ERP -> PM date text (YYYY-MM-DD), in Jakarta time for
 * timestamps. Returns undefined when absent, null when explicitly null, 'invalid' when
 * the value can't be read.
 */
export function toPmDate(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "head.of-finance@kpn-corp.com" -> "Head Of Finance" (name for an auto-created user). */
export function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || String(email || '');
}

/** Compare ERP Ticket Numbers / codes: trimmed, case-insensitive, leading "#" ignored. */
export function idKey(v) {
  return String(v ?? '').trim().replace(/^#/, '').toLowerCase();
}
