// ERP modules: a reference copy of the ERP CR system's "modules" master.
//
//   GET    /api/erp-modules          list (any signed-in user: pickers and labels)
//   POST   /api/erp-modules          add one            (admin)
//   POST   /api/erp-modules/bulk     add/update many by id, e.g. an ERP export (admin)
//   PUT    /api/erp-modules/:id      edit name / description / department / active (admin)
//
// The id is ERP's modules.id and never changes. There is no delete on purpose: a CR or
// a DWS application may still point at a module, so it is marked inactive instead.

import express from 'express';
import store from '../store.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const now = () => new Date().toISOString();
const MAX_LEN = 255; // ERP columns are VARCHAR(255)

const text = (v) => (v == null ? '' : String(v).trim());

/** Validate one module from a request. Returns { module } or { error }. */
function parseModule(body, { requireId }) {
  const id = text(body?.id);
  const name = text(body?.name);
  if (requireId && !id) return { error: 'id (ERP modules.id) is required' };
  if (id.includes(',')) return { error: 'id may not contain a comma' };
  if (!name) return { error: `name is required${id ? ` (module ${id})` : ''}` };
  for (const [k, v] of [['id', id], ['name', name], ['erpDepartmentId', text(body?.erpDepartmentId)]]) {
    if (v.length > MAX_LEN) return { error: `${k} may be at most ${MAX_LEN} characters` };
  }
  return {
    module: {
      id,
      name,
      description: text(body?.description) || null,
      erpDepartmentId: text(body?.erpDepartmentId) || null,
      isActive: body?.isActive === undefined ? true : body.isActive !== false && body.isActive !== 'false',
    },
  };
}

router.get('/', async (_req, res) => {
  const data = await store.read();
  const items = (data.erpModules || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  res.json(items);
});

router.post('/', requireAdmin, async (req, res) => {
  const { module, error } = parseModule(req.body, { requireId: true });
  if (error) return res.status(400).json({ error });
  const data = await store.read();
  if (!data.erpModules) data.erpModules = [];
  if (data.erpModules.some((m) => m.id === module.id)) {
    return res.status(409).json({ error: `Module ${module.id} already exists` });
  }
  const ts = now();
  data.erpModules.push({ ...module, createdAt: ts, updatedAt: ts });
  await store.write(data);
  res.status(201).json({ id: module.id });
});

// Upsert by id; modules not in the list are left as they are.
router.post('/bulk', requireAdmin, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ error: 'Send a non-empty list of modules' });
  if (list.length > 2000) return res.status(400).json({ error: 'At most 2000 modules per request' });

  const parsed = [];
  const seen = new Set();
  for (const [i, raw] of list.entries()) {
    const { module, error } = parseModule(raw, { requireId: true });
    if (error) return res.status(400).json({ error: `Row ${i + 1}: ${error}` });
    if (seen.has(module.id)) return res.status(400).json({ error: `Row ${i + 1}: module ${module.id} appears twice` });
    seen.add(module.id);
    parsed.push(module);
  }

  const data = await store.read();
  if (!data.erpModules) data.erpModules = [];
  const byId = new Map(data.erpModules.map((m) => [m.id, m]));
  const ts = now();
  let created = 0;
  let updated = 0;
  for (const m of parsed) {
    const existing = byId.get(m.id);
    if (!existing) {
      data.erpModules.push({ ...m, createdAt: ts, updatedAt: ts });
      created += 1;
      continue;
    }
    const changed = ['name', 'description', 'erpDepartmentId', 'isActive'].some((k) => (existing[k] ?? null) !== (m[k] ?? null));
    if (changed) {
      Object.assign(existing, m, { updatedAt: ts });
      updated += 1;
    }
  }
  if (created || updated) await store.write(data);
  res.json({ ok: true, created, updated, unchanged: parsed.length - created - updated });
});

router.put('/:id', requireAdmin, async (req, res) => {
  const data = await store.read();
  const existing = (data.erpModules || []).find((m) => m.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { module, error } = parseModule({ ...existing, ...req.body, id: existing.id }, { requireId: true });
  if (error) return res.status(400).json({ error });
  Object.assign(existing, module, { updatedAt: now() });
  await store.write(data);
  res.json({ ok: true });
});

export default router;
