// CR fields that come from the ERP CR system (same meaning as ERP change_requests
// columns): module_id, t_code, functional_department, cr_reference. ERP's has_reference
// flag is not stored: a CR has a reference when crReference is filled in.

export const ERP_CR_FIELDS = ['erpModuleId', 'tCode', 'functionalDepartment', 'crReference'];
const MAX_LEN = 255; // ERP columns are VARCHAR(255)

/**
 * Clean the ERP CR fields present in `body` (absent fields are left out, so an update
 * that doesn't send them keeps the stored values). Empty text becomes null.
 * erpModuleId must name a known ERP module.
 * @returns {{ values: object } | { error: string }}
 */
export function readErpCrFields(body, data) {
  const values = {};
  for (const k of ERP_CR_FIELDS) {
    if (!body || !(k in body)) continue;
    const raw = body[k];
    if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') return { error: `${k} must be text` };
    const v = raw == null ? '' : String(raw).trim();
    if (v.length > MAX_LEN) return { error: `${k} may be at most ${MAX_LEN} characters` };
    values[k] = v || null;
  }
  if (values.erpModuleId && !(data.erpModules || []).some((m) => m.id === values.erpModuleId)) {
    return { error: `Unknown ERP module: ${values.erpModuleId}` };
  }
  return { values };
}
