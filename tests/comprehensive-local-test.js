/**
 * Comprehensive local Docker test suite.
 * Usage: node tests/comprehensive-local-test.js
 * Env: BASE_URL (default http://localhost:8080), TEST_EMAIL, TEST_PASSWORD
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PROJECT_MILESTONE_LIVE_WARRANTY,
  PROJECT_MILESTONE_LEGACY_LIVE,
  normalizeProjectMilestone,
} from '../backend/projectMilestones.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:13000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TIMEOUT_MS = 15000;

let AUTH_TOKEN = null;
const results = [];

async function fetchJSON(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (AUTH_TOKEN && !headers.Authorization) {
    headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  }
  const response = await fetch(url, { ...options, headers });
  const text = await response.text().catch(() => '');
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

async function login() {
  const res = await fetchJSON(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.body)}`);
  AUTH_TOKEN = res.body?.token || res.body?.accessToken;
  if (!AUTH_TOKEN) throw new Error('Login succeeded but no token returned');
}

function record(category, name, passed, message, extra = {}) {
  results.push({
    category,
    name,
    passed,
    message,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

async function runTest(category, name, fn) {
  try {
    const message = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout')), TIMEOUT_MS)
      ),
    ]);
    record(category, name, true, message);
    console.log(`✅ [${category}] ${name}: ${message}`);
    return true;
  } catch (err) {
    record(category, name, false, err.message);
    console.log(`❌ [${category}] ${name}: ${err.message}`);
    return false;
  }
}

function isLiveWarrantyMilestone(milestone) {
  const m = normalizeProjectMilestone(milestone);
  return m === PROJECT_MILESTONE_LIVE_WARRANTY || milestone === PROJECT_MILESTONE_LEGACY_LIVE;
}

async function runBackendTests() {
  await runTest('Infrastructure', 'Frontend health endpoint', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const text = await res.text();
    if (!res.ok || !text.includes('healthy')) throw new Error(`Unexpected: ${res.status} ${text}`);
    return 'Frontend nginx healthy';
  });

  await runTest('Infrastructure', 'Backend direct port reachable', async () => {
    const res = await fetchJSON(`${BACKEND_URL}/api/lookups`);
    if (!res.ok) throw new Error(`Backend ${BACKEND_URL} returned ${res.status}`);
    return `Backend direct OK (${res.status})`;
  });

  await runTest('Auth', 'Admin login', async () => {
    await login();
    return `Logged in as ${TEST_EMAIL}`;
  });

  await runTest('Auth', 'Profile endpoint', async () => {
    const res = await fetchJSON(`${BASE_URL}/api/profile`);
    if (!res.ok) throw new Error(`Profile failed: ${res.status}`);
    if (!res.body?.email) throw new Error('Profile missing email');
    return `Profile: ${res.body.name || res.body.email}`;
  });

  const apiEndpoints = [
    { path: '/api/lookups', check: (b) => Array.isArray(b.users) && b.users.length > 0 },
    { path: '/api/initiatives?type=Project', check: (b) => Array.isArray(b) && b.length > 0 },
    { path: '/api/initiatives?type=CR', check: (b) => Array.isArray(b) && b.length > 0 },
    { path: '/api/dashboard', check: (b) => typeof b.projects === 'number' },
    { path: '/api/cr-dashboard', check: (b) => b && typeof b === 'object' },
    { path: '/api/user-dashboard', check: (b) => b && typeof b === 'object' },
    { path: '/api/notifications/unread-count', check: (b) => typeof b.count === 'number' },
    { path: '/api/dws-applications', check: (b) => Array.isArray(b) },
    { path: '/api/admin/users', check: (b) => Array.isArray(b) && b.length > 0 },
    { path: '/api/admin/roles', check: (b) => Array.isArray(b) },
    { path: '/api/tasks/enums', check: (b) => b && typeof b === 'object' },
    { path: '/api/daily-snapshots/milestone-durations', check: (b) => Array.isArray(b) },
  ];

  for (const ep of apiEndpoints) {
    await runTest('API', ep.path, async () => {
      const res = await fetchJSON(`${BASE_URL}${ep.path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!ep.check(res.body)) throw new Error('Response validation failed');
      const count = Array.isArray(res.body) ? res.body.length : 'OK';
      return `HTTP 200 (${count})`;
    });
  }

  await runTest('API', 'Initiative detail by ID', async () => {
    const list = await fetchJSON(`${BASE_URL}/api/initiatives?type=Project`);
    if (!list.ok || !list.body?.length) throw new Error('No projects');
    const id = list.body[0].id;
    const detail = await fetchJSON(`${BASE_URL}/api/initiatives/${id}`);
    if (!detail.ok) throw new Error(`Detail failed: ${detail.status}`);
    if (!detail.body?.name) throw new Error('Detail missing name');
    return `Loaded project: ${detail.body.name}`;
  });

  await runTest('API', 'CR timeline fields', async () => {
    const list = await fetchJSON(`${BASE_URL}/api/initiatives?type=CR`);
    if (!list.ok || !list.body?.length) throw new Error('No CRs');
    const detail = await fetchJSON(`${BASE_URL}/api/initiatives/${list.body[0].id}`);
    if (!detail.body?.cr) throw new Error('CR extension missing');
    const fields = ['developmentStart', 'uatStart', 'liveStart'];
    for (const f of fields) {
      if (!(f in detail.body.cr)) throw new Error(`Missing ${f}`);
    }
    return 'CR timeline structure valid';
  });

  await runTest('Management Dashboard', 'Dashboard loads', async () => {
    const res = await fetchJSON(`${BASE_URL}/api/management-dashboard`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = res.body;
    if (!Array.isArray(d.timelineProgress)) throw new Error('timelineProgress missing');
    if (!Array.isArray(d.itProjectLiveWarranty)) throw new Error('itProjectLiveWarranty missing');
    if (!Array.isArray(d.crFunnel)) throw new Error('crFunnel missing');
    return `timeline=${d.timelineProgress.length}, warranty=${d.itProjectLiveWarranty.length}, crs=${d.highPriorityCrs?.length ?? 0}`;
  });

  await runTest('Management Dashboard', 'Timeline excludes Live (Warranty Period)', async () => {
    const res = await fetchJSON(`${BASE_URL}/api/management-dashboard`);
    const timeline = res.body.timelineProgress || [];
    const bad = timeline.filter((p) => isLiveWarrantyMilestone(p.milestone));
    if (bad.length > 0) {
      throw new Error(
        `Found ${bad.length} warranty milestone project(s) in timeline: ${bad.map((p) => p.name).join(', ')}`
      );
    }
    return `All ${timeline.length} timeline projects exclude warranty milestone`;
  });

  await runTest('Management Dashboard', 'Warranty section contains warranty projects', async () => {
    const res = await fetchJSON(`${BASE_URL}/api/management-dashboard`);
    const warranty = res.body.itProjectLiveWarranty || [];
    if (warranty.length === 0) return 'No warranty projects in DB (skipped validation)';
    const allWarranty = warranty.every((p) => isLiveWarrantyMilestone(p.milestone));
    if (!allWarranty) throw new Error('Non-warranty project in warranty section');
    return `${warranty.length} warranty project(s) correctly listed`;
  });

  await runTest('Management Dashboard', 'Department group filter', async () => {
    const res = await fetchJSON(`${BASE_URL}/api/management-dashboard?departmentGroup=invalid`);
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return 'Invalid departmentGroup returns 400';
  });
}

async function runFrontendStaticTests() {
  const pages = [
    { name: 'Homepage', url: `${BASE_URL}/`, mustInclude: ['main.js'] },
    { name: 'Project List', url: `${BASE_URL}/#list`, mustInclude: ['main.js'] },
    { name: 'CR List', url: `${BASE_URL}/#crlist`, mustInclude: ['main.js'] },
    { name: 'Project Dashboard', url: `${BASE_URL}/#dashboard`, mustInclude: ['main.js'] },
    { name: 'CR Dashboard', url: `${BASE_URL}/#crdashboard`, mustInclude: ['main.js'] },
    { name: 'Management Dashboard shell', url: `${BASE_URL}/#management-dashboard`, mustInclude: ['main.js'] },
  ];

  for (const page of pages) {
    await runTest('Frontend Static', page.name, async () => {
      const res = await fetch(page.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      for (const needle of page.mustInclude) {
        if (!html.includes(needle)) throw new Error(`Missing "${needle}" in HTML`);
      }
      return `Page shell OK (${page.mustInclude.length} checks)`;
    });
  }
}

async function main() {
  console.log(`\n🧪 Comprehensive Local Test Suite`);
  console.log(`   BASE_URL=${BASE_URL}`);
  console.log(`   BACKEND_URL=${BACKEND_URL}`);
  console.log(`   TEST_EMAIL=${TEST_EMAIL}\n`);
  console.log('='.repeat(60));

  await runBackendTests();
  await runFrontendStaticTests();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const summary = {
    runAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    backendUrl: BACKEND_URL,
    testEmail: TEST_EMAIL,
    passed,
    failed,
    total: results.length,
    successRate: Math.round((passed / (passed + failed || 1)) * 100),
    results,
  };

  const outDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `test-results-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Results: ${passed} passed, ${failed} failed (${summary.successRate}%)`);
  console.log(`📄 JSON report: ${outFile}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
