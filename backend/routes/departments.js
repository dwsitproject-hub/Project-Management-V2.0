// Department Master (admin only): list, add, rename and delete departments.
// Everything else reads departments through /api/lookups, so a change here shows up in
// every Department field / filter / dashboard.
//
// Names are matched the way PM shows them (normalizeDepartmentName: "Operation" is shown
// as "Industrial", "Trader" as "Commercial"), so two departments can't end up looking the
// same. A department still used by projects / CRs / users can only be deleted by moving
// them to another department (or clearing it); moved projects get a Change History entry.

import express from 'express';
import crypto from 'crypto';
import store from '../store.js';
import { normalizeDepartmentName } from '../departmentGroups.js';

const router = express.Router();
const MAX_NAME = 100;

const cleanName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const shownKey = (name) => normalizeDepartmentName(cleanName(name)).toLowerCase();

function usage(data, id) {
  const inits = (data.initiatives || []).filter((i) => i.departmentId === id);
  return {
    projects: inits.filter((i) => i.type === 'Project').length,
    crs: inits.filter((i) => i.type === 'CR').length,
    users: (data.users || []).filter((u) => u.departmentId === id).length,
  };
}

/** Error text when `name` is unusable (optionally ignoring the department being renamed). */
function nameProblem(data, name, exceptId) {
  if (!name) return 'Department name is required';
  if (name.length > MAX_NAME) return `Department name is too long (max ${MAX_NAME} characters)`;
  const clash = (data.departments || []).find((d) => d.id !== exceptId && (
    cleanName(d.name).toLowerCase() === name.toLowerCase() || shownKey(d.name) === shownKey(name)
  ));
  if (!clash) return null;
  const shown = normalizeDepartmentName(clash.name);
  return `A department with this name already exists: "${clash.name}"${shown !== clash.name ? ` (shown as "${shown}")` : ''}`;
}

router.get('/', async (_req, res) => {
  const data = await store.read();
  const rows = (data.departments || [])
    .map((d) => ({ id: d.id, name: d.name, shownAs: normalizeDepartmentName(d.name), ...usage(data, d.id) }))
    .sort((a, b) => a.shownAs.localeCompare(b.shownAs) || a.name.localeCompare(b.name));
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const name = cleanName(req.body?.name);
    const data = await store.read();
    const problem = nameProblem(data, name);
    if (problem) return res.status(400).json({ error: problem });
    const dept = { id: crypto.randomUUID(), name };
    if (!data.departments) data.departments = [];
    data.departments.push(dept);
    await store.write(data);
    console.log(`[DEPARTMENTS] added "${name}" by ${req.user.email || req.user.id}`);
    res.status(201).json(dept);
  } catch (e) {
    console.error('[departments POST]', e);
    res.status(500).json({ error: 'Failed to add department' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const name = cleanName(req.body?.name);
    const data = await store.read();
    const dept = (data.departments || []).find((d) => d.id === req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    const problem = nameProblem(data, name, dept.id);
    if (problem) return res.status(400).json({ error: problem });
    const old = dept.name;
    dept.name = name;
    await store.write(data);
    console.log(`[DEPARTMENTS] renamed "${old}" -> "${name}" by ${req.user.email || req.user.id}`);
    res.json({ id: dept.id, name: dept.name, shownAs: normalizeDepartmentName(dept.name) });
  } catch (e) {
    console.error('[departments PUT]', e);
    res.status(500).json({ error: 'Failed to rename department' });
  }
});

// Body: { reassignTo: <departmentId> | null } — required (null = leave them without a
// department) when the department is still used; ignored otherwise.
router.delete('/:id', async (req, res) => {
  try {
    const data = await store.read();
    const dept = (data.departments || []).find((d) => d.id === req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    const used = usage(data, dept.id);
    const inUse = used.projects + used.crs + used.users > 0;
    const body = req.body || {};

    let target = null;
    if (inUse) {
      if (!('reassignTo' in body)) {
        return res.status(409).json({ error: 'Department is still in use', ...used });
      }
      if (body.reassignTo !== null) {
        target = (data.departments || []).find((d) => d.id === body.reassignTo && d.id !== dept.id);
        if (!target) return res.status(400).json({ error: 'Choose another existing department (or none)' });
      }
      const now = new Date().toISOString();
      const changedBy = req.user.id || 'Unknown';
      if (!data.changeHistory) data.changeHistory = [];
      for (const i of data.initiatives || []) {
        if (i.departmentId !== dept.id) continue;
        i.departmentId = target ? target.id : null;
        i.updatedAt = now;
        data.changeHistory.push({
          id: crypto.randomUUID(),
          initiativeId: i.id,
          timestamp: now,
          changedBy,
          changes: [{
            field: 'departmentId', oldValue: dept.id, newValue: target ? target.id : null,
            changedAt: now, changedBy,
          }],
        });
      }
      for (const u of data.users || []) {
        if (u.departmentId === dept.id) u.departmentId = target ? target.id : null;
      }
    }

    data.departments = data.departments.filter((d) => d.id !== dept.id);
    await store.write(data);
    console.log(`[DEPARTMENTS] deleted "${dept.name}" by ${req.user.email || req.user.id}` +
      (inUse ? ` (${used.projects} projects, ${used.crs} CRs, ${used.users} users -> ${target ? `"${target.name}"` : 'no department'})` : ''));
    res.json({ ok: true, moved: inUse ? used : null, movedTo: target ? target.id : null });
  } catch (e) {
    console.error('[departments DELETE]', e);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

export default router;
