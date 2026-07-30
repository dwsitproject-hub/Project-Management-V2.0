import express from 'express';
import store from '../store.js';
import crypto from 'crypto';
import { requireAdmin } from '../middleware/auth.js';
import { normalizeCrMilestonePhase } from '../crTaskTemplates.js';

const router = express.Router();

const now = () => new Date().toISOString();

// Admin-only master data management
router.use(requireAdmin);

router.get('/', async (_req, res) => {
  const data = await store.read();
  const apps = (data.dwsApplications || []).slice().sort((a, b) => String(a.systemName || '').localeCompare(String(b.systemName || '')));
  res.json(apps);
});

// List CRs impacting a given DWS application (via initiatives.systemImpactedIds)
router.get('/:id/crs', async (req, res) => {
  const { id } = req.params;
  const data = await store.read();
  const appRow = (data.dwsApplications || []).find((a) => a.id === id);
  if (!appRow) return res.status(404).json({ error: 'Not found' });

  const items = (data.initiatives || [])
    .filter((i) => i.type === 'CR')
    .filter((i) => {
      const raw = i.systemImpactedIds || [];
      const ids = Array.isArray(raw)
        ? raw
        : String(raw).split(',').map((x) => x.trim()).filter(Boolean);
      return ids.includes(id);
    })
    .map((i) => ({
      id: i.id,
      ticket: i.ticket || null,
      name: i.name || null,
      priority: i.priority || null,
      status: i.status || null,
      milestone: normalizeCrMilestonePhase(i.milestone),
      businessImpact: i.businessImpact || null,
      remark: i.remark || null,
      createdAt: i.createdAt || null,
    }));

  // Sort: open CRs first (Live/Cancelled last), then priority P0 > P1 > P2, then oldest created first
  const CLOSED_STATUSES = new Set(['LIVE', 'CANCELLED']);
  const statusRank = (s) => (CLOSED_STATUSES.has(String(s || '').trim().toUpperCase()) ? 1 : 0);
  const priorityRank = (p) => {
    const v = String(p || '').trim().toUpperCase();
    return v === 'P0' ? 0 : v === 'P1' ? 1 : v === 'P2' ? 2 : 3;
  };
  items.sort((a, b) =>
    (statusRank(a.status) - statusRank(b.status)) ||
    (priorityRank(a.priority) - priorityRank(b.priority)) ||
    String(a.createdAt || '9999').localeCompare(String(b.createdAt || '9999'))
  );

  res.json({ systemName: appRow.systemName, items });
});

router.post('/', async (req, res) => {
  const { systemName, productionUrl, stagingUrl, githubUrl } = req.body || {};
  if (!systemName || String(systemName).trim() === '') {
    return res.status(400).json({ error: 'System Name is required' });
  }
  const data = await store.read();
  if (!data.dwsApplications) data.dwsApplications = [];

  const id = crypto.randomUUID();
  const ts = now();
  data.dwsApplications.push({
    id,
    systemName: String(systemName).trim(),
    productionUrl: productionUrl ? String(productionUrl).trim() : null,
    stagingUrl: stagingUrl ? String(stagingUrl).trim() : null,
    githubUrl: githubUrl ? String(githubUrl).trim() : null,
    createdAt: ts,
    updatedAt: ts,
  });
  await store.write(data);
  res.status(201).json({ id });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { systemName, productionUrl, stagingUrl, githubUrl } = req.body || {};
  if (!systemName || String(systemName).trim() === '') {
    return res.status(400).json({ error: 'System Name is required' });
  }
  const data = await store.read();
  const idx = (data.dwsApplications || []).findIndex((a) => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  data.dwsApplications[idx] = {
    ...data.dwsApplications[idx],
    systemName: String(systemName).trim(),
    productionUrl: productionUrl ? String(productionUrl).trim() : null,
    stagingUrl: stagingUrl ? String(stagingUrl).trim() : null,
    githubUrl: githubUrl ? String(githubUrl).trim() : null,
    updatedAt: now(),
  };
  await store.write(data);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const data = await store.read();
  const before = (data.dwsApplications || []).length;
  data.dwsApplications = (data.dwsApplications || []).filter((a) => a.id !== id);
  await store.write(data);
  res.json({ ok: true, deleted: before - data.dwsApplications.length });
});

export default router;

