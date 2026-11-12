// External IDs: identifiers of the matching record in another system, e.g. the ERP CR
// Ticket Number on an initiative, or ERP SAP module codes ("FI", "CO") on a DWS
// application. Stored comma-separated in a TEXT column like the other *Ids fields, so a
// single value may not contain a comma.

export const MAX_EXTERNAL_IDS = 50;
export const MAX_EXTERNAL_ID_LENGTH = 100;

/**
 * Normalize request input (array, comma-separated string, null) to a clean list:
 * trimmed, empty values dropped, duplicates removed ignoring case (first spelling kept).
 * @returns {{ ids: string[] } | { error: string }}
 */
export function normalizeExternalIds(raw) {
  if (raw == null || raw === '') return { ids: [] };
  let values;
  if (Array.isArray(raw)) {
    values = raw;
    if (values.some((v) => typeof v !== 'string' && typeof v !== 'number')) {
      return { error: 'externalIds must be a list of text values' };
    }
    if (values.some((v) => String(v).includes(','))) {
      return { error: 'An external ID may not contain a comma' };
    }
  } else if (typeof raw === 'string') {
    values = raw.split(',');
  } else {
    return { error: 'externalIds must be a list or a comma-separated text' };
  }

  const ids = [];
  const seen = new Set();
  for (const v of values) {
    const id = String(v).trim();
    if (!id) continue;
    if (id.length > MAX_EXTERNAL_ID_LENGTH) {
      return { error: `An external ID may be at most ${MAX_EXTERNAL_ID_LENGTH} characters` };
    }
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  if (ids.length > MAX_EXTERNAL_IDS) {
    return { error: `At most ${MAX_EXTERNAL_IDS} external IDs are allowed` };
  }
  return { ids };
}

/** Stored value (array or legacy CSV text) -> array. */
export function toExternalIdList(raw) {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  return String(raw || '').split(',').map((v) => v.trim()).filter(Boolean);
}

/**
 * An external ID may belong to only one record of a table (compared ignoring case),
 * otherwise a lookup by it would be ambiguous. Returns the first clash or null.
 * @param {Array<object>} rows - all records of the table
 * @param {string[]} ids - the IDs about to be saved
 * @param {string|null} selfId - the record being saved (excluded from the check)
 * @returns {{ externalId: string, row: object } | null}
 */
export function findExternalIdConflict(rows, ids, selfId) {
  if (!ids.length) return null;
  const wanted = new Map(ids.map((id) => [id.toLowerCase(), id]));
  for (const row of rows || []) {
    if (row.id === selfId) continue;
    for (const existing of toExternalIdList(row.externalIds)) {
      const hit = wanted.get(existing.toLowerCase());
      if (hit) return { externalId: hit, row };
    }
  }
  return null;
}
