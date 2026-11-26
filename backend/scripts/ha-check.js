// HA checks for two backend nodes on one database and one shared uploads folder
// (docs/ZONE-B-PILOT.md §10). Runs as a one-off container on the app's network, so it
// needs nothing installed on the server:
//
//   /opt/Project-Management-V2.0/deploy/zone-b-pilot/dc.sh be run --rm --no-deps \
//     -e PM_LOCAL_EMAIL=you@energi-up.com pm-api-1 node backend/scripts/ha-check.js
//
// Signs in with PM_LOCAL_EMAIL / PM_LOCAL_PASSWORD (an admin, for the clean-up), creates
// test records named "HA CHECK <run id>", checks them through both nodes, and deletes
// them again. NEVER point it at production: it writes, and it needs Mailpit.
//
// Settings (environment): HA_NODE1 (http://pm-api-1:3000), HA_NODE2 (http://pm-api-2:3000),
// HA_MAILPIT (http://mailpit:8025), DATABASE_URL (from the secrets file).
import pg from 'pg';

const N1 = process.env.HA_NODE1 || 'http://pm-api-1:3000';
const N2 = process.env.HA_NODE2 || 'http://pm-api-2:3000';
const MAILPIT = `${process.env.HA_MAILPIT || 'http://mailpit:8025'}/api/v1`;
const RUN = `HA CHECK ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const sql = async (q, params = []) => (await db.query(q, params)).rows;

let fail = 0;
const check = (name, ok, extra) => {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || extra === undefined ? '' : `  ${JSON.stringify(extra)}`}`);
};
let TOKEN = '';
async function api(base, method, path, body, isForm) {
  const t = Date.now();
  const r = await fetch(base + path, {
    method,
    headers: { ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { j = text; }
  return { s: r.status, j, ms: Date.now() - t };
}
async function mails(subjectPart) {
  const list = await (await fetch(`${MAILPIT}/messages?limit=200`)).json();
  return (list.messages || []).filter((m) => String(m.Subject).includes(subjectPart));
}
async function waitFor(fn, seconds) {
  for (let i = 0; i < seconds; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(1000);
  }
  return null;
}

const created = [];
try {
  // ---- 0. both nodes ready, sign in
  for (const [name, n] of [['node 1', N1], ['node 2', N2]]) {
    const h = await api(n, 'GET', '/health/ready');
    check(`${name} ready (${n})`, h.s === 200, h.j);
  }
  const login = await api(N1, 'POST', '/api/auth/login', { email: process.env.PM_LOCAL_EMAIL, password: process.env.PM_LOCAL_PASSWORD });
  if (login.s !== 200 || !login.j?.token) throw new Error(`sign-in as ${process.env.PM_LOCAL_EMAIL} failed (${login.s}): run set-local-password.js first (guide §9)`);
  TOKEN = login.j.token;

  const lookups = (await api(N1, 'GET', '/api/lookups')).j;
  const u = lookups.users.filter((x) => x.active !== false);
  const sap = lookups.dwsApplications.find((a) => a.systemName === 'SAP FICO');
  const base = (name, type, extra = {}) => ({
    type, name, description: 'HA check', businessImpact: 'HA check', priority: 'P2', businessOwnerId: u[0].id,
    businessUserIds: [u[1].id], departmentId: lookups.departments[0].id, itPicIds: [u[2].id], itPmId: u[2].id,
    itManagerIds: [u[3].id], status: 'Not Started', milestone: type === 'CR' ? 'CR Created' : 'Preparation',
    startDate: '2027-01-01', planStartDate: '2027-01-01', ...extra,
  });

  // ---- 1. a save on one node is seen on the other at once
  await api(N1, 'GET', '/api/initiatives');
  await api(N2, 'GET', '/api/initiatives');
  const v0 = Number((await sql('SELECT "version" FROM "storeMeta"'))[0].version);
  let r = await api(N1, 'POST', '/api/initiatives', base(`${RUN} project`, 'Project'));
  if (r.s !== 201) throw new Error(`create failed: ${r.s} ${JSON.stringify(r.j)}`);
  const projectId = r.j.id; created.push(projectId);
  const seen2 = await api(N2, 'GET', '/api/initiatives');
  check(`created on node 1, visible on node 2 on the next request (${seen2.ms} ms)`, seen2.j.some((i) => i.id === projectId));
  check('the save bumped the shared version', Number((await sql('SELECT "version" FROM "storeMeta"'))[0].version) > v0);
  await api(N2, 'PUT', `/api/initiatives/${projectId}`, { remark: 'edited on node 2', changedBy: 'ha-check' });
  const seen1 = await api(N1, 'GET', `/api/initiatives/${projectId}`);
  check(`edited on node 2, visible on node 1 on the next request (${seen1.ms} ms)`, seen1.j?.remark === 'edited on node 2', seen1.j?.remark);

  // ---- 2. CR creation e-mail: documents through BOTH nodes -> ONE e-mail with both files
  if (!sap) {
    check('a DWS application named "SAP FICO" exists (needed for the e-mail check)', false);
  } else {
    r = await api(N1, 'POST', '/api/initiatives', base(`${RUN} CR`, 'CR', { systemImpactedIds: [sap.id] }));
    const crId = r.j.id; created.push(crId);
    const q = await sql('SELECT "status" FROM "crEmailQueue" WHERE "initiativeId" = $1', [crId]);
    check('SAP CR queued its creation e-mail', q[0]?.status === 'pending', q);
    for (const [node, name] of [[N1, 'spec-node1.txt'], [N2, 'spec-node2.txt']]) {
      const fd = new FormData();
      fd.append('initiativeId', crId);
      fd.append('file', new Blob([`HA check file ${name}`], { type: 'text/plain' }), name);
      const up = await api(node, 'POST', '/api/documents', fd, true);
      check(`upload ${name} through ${node === N1 ? 'node 1' : 'node 2'}`, up.s === 201, up.j);
    }
    const sent = await waitFor(async () => (await sql('SELECT "status" FROM "crEmailQueue" WHERE "initiativeId" = $1', [crId]))[0]?.status === 'sent', 60);
    check('e-mail sent by one of the nodes (within 60 s)', !!sent);
    await sleep(15000); // two more sweeps on each node
    const got = await mails(`${RUN} CR`);
    check(`exactly one e-mail in Mailpit (${got.length})`, got.length === 1);
    if (got[0]) {
      const msg = await (await fetch(`${MAILPIT}/message/${got[0].ID}`)).json();
      check(`both documents attached (${(msg.Attachments || []).map((a) => a.FileName).join(', ')})`, (msg.Attachments || []).length === 2);
    }

    // ---- 3. a file uploaded through node 2 downloads through node 1
    const docs = (await api(N1, 'GET', `/api/documents/initiative/${crId}`)).j;
    const d2 = docs.find((d) => d.fileName === 'spec-node2.txt');
    const dl = await fetch(`${N1}/api/documents/${d2.id}/download`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    check('file uploaded through node 2 downloads through node 1', dl.status === 200 && (await dl.text()) === 'HA check file spec-node2.txt');
  }
} catch (e) {
  fail++;
  console.log(`FAIL  ${e.message}`);
} finally {
  // ---- clean up: delete the test records (and their files) through the app
  for (const id of created) {
    const del = await api(N1, 'DELETE', `/api/initiatives/${id}`);
    if (del.s !== 200) console.log(`WARN  could not delete ${id}: ${del.s}`);
  }
  if (created.length) await sql('DELETE FROM "crEmailQueue" WHERE "initiativeId" = ANY($1)', [created]).catch(() => {});
  const left = Number((await sql('SELECT count(*) FROM initiatives WHERE name LIKE $1', [`${RUN}%`]))[0].count);
  check('test records removed', left === 0, left);
  await db.end();
  console.log(fail ? `${fail} check(s) FAILED` : 'ALL CHECKS PASSED');
  process.exit(fail ? 1 : 0);
}
