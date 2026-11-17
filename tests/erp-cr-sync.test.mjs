// Unit tests for the ERP CR sync (API v1.1) mapping and create/update logic (no database needed).
//   node --test tests/erp-cr-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapStatus, mapPriority, mapMilestone, htmlToText, crNameFrom, toPmDate, nameFromEmail, isExtendedStageType,
} from '../backend/services/erp-cr-mapper.js';
import { applyCr } from '../backend/routes/erp-integration.js';

test('status mapping (workbook Status tab)', () => {
  assert.equal(mapStatus('In Progress'), 'On Track');
  assert.equal(mapStatus(' delayed '), 'Delayed');
  assert.equal(mapStatus('Delated'), 'Delayed');
  assert.equal(mapStatus('Completed'), 'Live');
  assert.equal(mapStatus('Cancelled'), 'Cancelled');
  assert.equal(mapStatus('On Hold'), null);
});

test('priority mapping', () => {
  assert.equal(mapPriority('High'), 'P0');
  assert.equal(mapPriority('medium'), 'P1');
  assert.equal(mapPriority('LOW'), 'P2');
  assert.equal(mapPriority('Urgent'), null);
});

test('milestone mapping by (segment, stage[, stageType])', () => {
  assert.equal(mapMilestone('preparation', '\tuser initation'), 'User Initiate');
  assert.equal(mapMilestone('Preparation', 'CR Creation'), 'CR Created');
  assert.equal(mapMilestone('Preparation', 'CR Verification'), 'CR Created');
  assert.equal(mapMilestone('Preparation', 'CR - Section 1'), 'CR - Section 1');
  assert.equal(mapMilestone('Preparation', 'CR Signed – Section 2'), 'CR Signed sec 2');
  // ERP's plural segment name
  assert.equal(mapMilestone('FSD Creation & Approvals', 'Developer Review'), 'FSD');
  assert.equal(mapMilestone('FSD Creation & Approval', 'FSD Approval'), 'FSD');
  assert.equal(mapMilestone('Development and SIT', 'SIT'), 'SIT');
  assert.equal(mapMilestone('Development and SIT', 'Extended Development'), 'Development - Extended');
  assert.equal(mapMilestone('Development and SIT', 'Update FSD Change Request'), 'Signed Changes');
  assert.equal(mapMilestone('Development and SIT', 'Update FSD Change Request Approval'), 'Signed Changes');
  assert.equal(mapMilestone('Development and SIT', 'Extended Developer Review'), 'SIT');
  // extended stages by type, whatever their name
  assert.equal(mapMilestone('Development and SIT', 'Extended Tuning', 'extended_development'), 'Development - Extended');
  assert.equal(mapMilestone('Development and SIT', 'Extended Regression SIT', 'extended_development'), 'SIT');
  assert.equal(mapMilestone('Development and SIT', 'Odd'), null);
  // segment-wide
  assert.equal(mapMilestone('UAT', 'Transport'), 'UAT');
  assert.equal(mapMilestone('UAT', 'Update FSD Change Request'), 'UAT');
  assert.equal(mapMilestone('Go-Live', 'anything'), 'Live (Warranty Period)');
  assert.equal(mapMilestone('GO-Live', 'GO-LIVE'), 'Live (Warranty Period)');
  assert.equal(mapMilestone('Configuration', 'Config Build'), 'Configuration');
  assert.equal(mapMilestone('Preparation', 'Unknown stage'), null);
  assert.equal(isExtendedStageType('extender_uat'), true);
  assert.equal(isExtendedStageType('uat'), false);
});

test('text helpers', () => {
  assert.equal(htmlToText('<p>Line&nbsp;one</p><p>Two &amp; three</p>'), 'Line one\nTwo & three');
  const long = 'x'.repeat(300);
  assert.equal(crNameFrom(long).length, 120);
  assert.ok(crNameFrom(long).endsWith('…'));
  assert.equal(crNameFrom('  short   name '), 'short name');
  assert.equal(toPmDate('2026-11-02'), '2026-11-02');
  assert.equal(toPmDate('2026-11-02T20:00:00Z'), '2026-11-03'); // Jakarta is UTC+7
  assert.equal(toPmDate('nope'), 'invalid');
  assert.equal(nameFromEmail('head.of-finance@kpn-corp.com'), 'Head Of Finance');
});

function fixture() {
  return {
    initiatives: [],
    changeRequests: [],
    tasks: [],
    changeHistory: [],
    documents: [],
    users: [
      { id: 'u-req', name: 'Requester', email: 'req@kpn-corp.com', active: true },
      { id: 'u-fun', name: 'Functional', email: 'Fun.Ctional@kpn-corp.com', active: true },
      { id: 'u-old', name: 'Gone', email: 'gone@kpn-corp.com', active: false },
    ],
    departments: [{ id: 'd-ap', name: 'AP', externalIds: ['AP1'] }],
    dwsApplications: [
      { id: 'app-fico', systemName: 'SAP FICO', externalIds: ['MD000000001', 'MD000000002'] },
      { id: 'app-nonfico', systemName: 'SAP NON FICO', externalIds: ['MD000000003'] },
    ],
    erpModules: [
      { id: 'MD000000001', name: 'Finance', isActive: true },
      { id: 'MD000000003', name: 'Materials', isActive: true },
    ],
    erpOptions: [],
  };
}

const CR1 = 'CR000000001';
const fullCr = (over = {}) => ({
  crId: CR1, ticketNumber: '#ERPO1', type: 'Change Request', projectType: false,
  changeRequest: '<p>Add vendor tax field</p>', note: 'Urgent for month end',
  moduleId: 'MD000000001', tCode: 'ZMM001', functionalDepartment: 'SAP FI', requesterDepartmentCode: null,
  ownership: { code: 'OWN1', name: 'Finance' }, impactAreas: [{ code: 'IA1', name: 'Payables' }, { code: 'IA2', name: 'Tax' }],
  priority: 'High', requesterEmail: 'REQ@kpn-corp.com', functionalEmail: 'fun.ctional@kpn-corp.com',
  deptHeadEmail: 'dept.head@kpn-corp.com', deptHeadName: 'Dept Head',
  dateCreation: '2026-11-02', targetResolved: '2026-12-15', createdAt: '2026-11-02T02:10:00Z', closedAt: null,
  status: 'In Progress', segment: 'Preparation', stage: 'CR Creation', crReference: null,
  ...over,
});
const put = (data, at, cr, path = CR1) => applyCr(data, { occurredAt: at, cr }, 'full', path);

test('PUT creates a CR keyed by CR ID, with the Ticket Number as PM Ticket', () => {
  const data = fixture();
  const r = put(data, '2026-11-02T03:00:00Z', fullCr());
  assert.equal(r.action, 'created');
  assert.equal(r.crId, CR1);
  assert.equal(r.ticketNumber, '#ERPO1');
  assert.equal(r.pmTicket, '#ERPO1');
  const i = data.initiatives[0];
  assert.deepEqual(i.externalIds, [CR1]);
  assert.equal(i.ticket, '#ERPO1');
  assert.equal(i.type, 'CR');
  assert.equal(i.name, 'Add vendor tax field');
  assert.equal(i.description, 'Urgent for month end\n\nAdd vendor tax field');
  assert.equal(i.status, 'On Track');
  assert.equal(i.milestone, 'CR Created');
  assert.equal(i.priority, 'P0');
  assert.equal(i.departmentId, null); // requesterDepartmentCode: null (N15)
  assert.deepEqual(i.systemImpactedIds, ['app-fico']);
  assert.equal(i.businessOwnerId, 'u-req');
  assert.equal(i.itPicId, 'u-fun');
  assert.equal(i.impactAreaCode, 'IA1,IA2');
  assert.equal(i.createdAt, '2026-11-02T02:10:00.000Z'); // ERP's creation time, not the sync time
  assert.equal(data.erpOptions.length, 3);
  assert.equal(data.tasks.length, 10); // no segments[] -> the default CR task list
  const head = data.users.find((u) => u.email === 'dept.head@kpn-corp.com');
  assert.equal(head.active, false);
  assert.deepEqual(i.itManagerIds, [head.id]);
  assert.ok(r.warnings.some((w) => w.code === 'USER_CREATED'));
});

test('two ERP CRs sharing a Ticket Number become two PM CRs', () => {
  const data = fixture();
  put(data, '2026-11-02T03:00:00Z', fullCr());
  const r2 = put(data, '2026-11-02T03:05:00Z', fullCr({ crId: 'CR000000002' }), 'CR000000002');
  assert.equal(r2.action, 'created');
  assert.equal(data.initiatives.length, 2);
  assert.deepEqual(data.initiatives.map((i) => i.ticket), ['#ERPO1', '#ERPO1']);
});

test('no Ticket Number: PM shows the CR ID as Ticket', () => {
  const data = fixture();
  const r = put(data, '2026-11-02T03:00:00Z', fullCr({ ticketNumber: null }));
  assert.equal(r.pmTicket, CR1);
  assert.equal(data.initiatives[0].ticket, CR1);
});

test('requester, functional and target are optional (warnings, not errors)', () => {
  const data = fixture();
  const cr = fullCr();
  delete cr.requesterEmail;
  delete cr.targetResolved;
  cr.functionalEmail = null;
  const r = put(data, '2026-11-02T03:00:00Z', cr);
  assert.equal(r.action, 'created');
  const codes = r.warnings.map((w) => `${w.code}:${w.field}`).sort();
  assert.ok(codes.includes('USER_UNMAPPED:cr.requesterEmail'));
  assert.ok(codes.includes('USER_UNMAPPED:cr.functionalEmail'));
  assert.ok(codes.includes('MISSING_FIELD:cr.targetResolved'));
  assert.equal(data.initiatives[0].businessOwnerId, null);
});

test('stale and repeated messages', () => {
  const data = fixture();
  put(data, '2026-11-02T03:00:00Z', fullCr());
  const stale = put(data, '2026-11-02T02:00:00Z', fullCr({ status: 'Cancelled' }));
  assert.equal(stale.action, 'ignored_stale');
  assert.equal(data.initiatives[0].status, 'On Track');
  const same = put(data, '2026-11-02T04:00:00Z', fullCr(), 'cr000000001');
  assert.equal(same.action, 'unchanged');
  assert.equal(data.initiatives.length, 1);
  assert.equal(data.users.filter((u) => u.email === 'dept.head@kpn-corp.com').length, 1);
});

test('PATCH updates only what is sent and records history; tasks follow the milestone', () => {
  const data = fixture();
  put(data, '2026-11-02T03:00:00Z', fullCr());
  const r = applyCr(data, { occurredAt: '2026-11-10T03:00:00Z', cr: { segment: 'Development and SIT', stage: 'SIT', status: 'Delayed' } }, 'partial', CR1);
  assert.equal(r.action, 'updated');
  assert.deepEqual(r.changedFields.sort(), ['milestone', 'status']);
  const i = data.initiatives[0];
  assert.equal(i.milestone, 'SIT');
  assert.equal(i.priority, 'P0');
  const done = data.tasks.filter((t) => t.status === 'done').map((t) => t.milestone);
  assert.deepEqual(done, ['User Initiate', 'CR Created', 'CR Signed sec 2', 'CR Signed Sec 3', 'FSD', 'Development']);
  assert.equal(data.changeHistory.at(-1).changedBy, 'ERP Integration');
});

const seg = (name, sequence, weight, status, stages) => ({ name, sequence, weight, status, progress: 0, stages });
const st = (name, sequence, status, extra = {}) => ({ name, sequence, type: null, status, progress: status === 'completed' ? 100 : 0, iteration: 1, ...extra });

test('segments[]: snapshot, progress and tasks from ERP stages', () => {
  const data = fixture();
  const segments = [
    seg('Preparation', 1, 20, 'completed', [
      st('CR - Section 1', 1, 'completed', { startDate: '2026-11-02', endDate: '2026-11-03' }),
      st('CR Signed - Section 2', 2, 'completed', { startDate: '2026-11-03', endDate: '2026-11-04' }),
      st('CR Signed - Section 3', 3, 'completed', { startDate: '2026-11-04', endDate: '2026-11-05' }),
    ]),
    seg('FSD Creation & Approvals', 2, 20, 'active', [
      st('FSD Creation', 1, 'completed', { startDate: '2026-11-05', endDate: '2026-11-07' }),
      st('Developer Review', 2, 'active', { startDate: '2026-11-07', progress: 40 }),
      st('FSD Approval', 3, 'inactive'),
    ]),
    seg('Development and SIT', 3, 30, 'inactive', [st('Development', 1, 'inactive'), st('SIT', 2, 'inactive')]),
    seg('UAT', 4, 15, 'inactive', [st('UAT', 1, 'inactive'), st('Transport', 2, 'inactive')]),
    seg('Go-Live', 5, 15, 'inactive', [st('GO-LIVE', 1, 'inactive')]),
  ];
  const r = put(data, '2026-11-08T03:00:00Z', fullCr({ segment: 'FSD Creation & Approvals', stage: 'Developer Review', progress: 20, segments }));
  assert.equal(r.action, 'created');
  const i = data.initiatives[0];
  assert.equal(i.milestone, 'FSD');
  assert.equal(i.erpProgress, 20);
  assert.equal(i.externalData.erpProgress.segments.length, 5);
  assert.equal(i.externalData.erpProgress.segments[1].weight, 20);
  const task = (m) => data.tasks.find((t) => t.initiativeId === i.id && t.milestone === m);
  // tasks created from stages only (plus User Initiate, CR Created, Fully Live)
  assert.deepEqual(data.tasks.map((t) => t.milestone).sort(), [
    'CR - Section 1', 'CR Created', 'CR Signed Sec 3', 'CR Signed sec 2', 'Development', 'FSD', 'Fully Live',
    'Live (Warranty Period)', 'SIT', 'UAT', 'User Initiate',
  ].sort());
  assert.equal(task('CR - Section 1').status, 'done');
  assert.equal(task('CR - Section 1').endDate, '2026-11-03');
  assert.equal(task('FSD').status, 'in progress');
  assert.equal(task('FSD').startDate, '2026-11-05');
  assert.equal(task('FSD').endDate, null);
  assert.match(task('FSD').description, /FSD Creation ✔, Developer Review 40%, FSD Approval –/);
  assert.equal(task('Development').status, 'not started');
  assert.equal(task('User Initiate').status, 'done');
  assert.equal(task('Fully Live').status, 'not started');

  // FSD Approval completes -> FSD done, Development in progress
  segments[1].status = 'completed';
  segments[1].stages[1] = st('Developer Review', 2, 'completed', { startDate: '2026-11-07', endDate: '2026-11-09' });
  segments[1].stages[2] = st('FSD Approval', 3, 'completed', { startDate: '2026-11-09', endDate: '2026-11-10' });
  segments[2].status = 'active';
  segments[2].stages[0] = st('Development', 1, 'active', { startDate: '2026-11-10' });
  put(data, '2026-11-10T03:00:00Z', fullCr({ segment: 'Development and SIT', stage: 'Development', progress: 40, segments }));
  assert.equal(task('FSD').status, 'done');
  assert.equal(task('FSD').endDate, '2026-11-10');
  assert.equal(task('Development').status, 'in progress');

  // FSD Approval sent back (reopened, iteration 2) -> FSD back to in progress, Development back to not started
  segments[1].status = 'active';
  segments[1].stages[2] = st('FSD Approval', 3, 'active', { startDate: '2026-11-09', iteration: 2, progress: 60 });
  segments[2].status = 'inactive';
  segments[2].stages[0] = st('Development', 1, 'inactive');
  put(data, '2026-11-11T03:00:00Z', fullCr({ segment: 'FSD Creation & Approvals', stage: 'FSD Approval', progress: 20, segments }));
  assert.equal(task('FSD').status, 'in progress');
  assert.equal(task('FSD').endDate, null);
  assert.match(task('FSD').description, /FSD Approval 60% \(×2\)/);
  assert.equal(task('Development').status, 'not started');
  assert.equal(task('Development').startDate, null);
  assert.equal(i.milestone, 'FSD');

  // Extension adds stages -> a Development - Extended task appears
  segments[2].stages.push(st('Extended Development', 3, 'inactive', { type: 'extended_development' }));
  put(data, '2026-11-12T03:00:00Z', fullCr({ segment: 'FSD Creation & Approvals', stage: 'FSD Approval', segments }));
  assert.equal(task('Development - Extended').status, 'not started');

  // Cancelled -> open tasks cancel, done tasks stay done
  put(data, '2026-11-13T03:00:00Z', fullCr({ status: 'Cancelled', segment: 'FSD Creation & Approvals', stage: 'FSD Approval', segments }));
  assert.equal(task('FSD').status, 'cancel');
  assert.equal(task('CR - Section 1').status, 'done');
  assert.equal(task('Fully Live').status, 'not started');
});

test('config CR and the Configuration milestone', () => {
  const data = fixture();
  const segments = [
    seg('Preparation', 1, 20, 'completed', [st('CR - Section 1', 1, 'completed')]),
    seg('Configuration', 2, 50, 'active', [st('Configuration', 1, 'active', { startDate: '2026-11-05', type: 'config' })]),
  ];
  const r = put(data, '2026-11-06T03:00:00Z', fullCr({ type: 'Configuration', segment: 'Configuration', stage: 'Configuration', segments }));
  assert.equal(r.warnings.filter((w) => w.code === 'UNMAPPED_STAGE').length, 0);
  assert.equal(data.initiatives[0].milestone, 'Configuration');
  assert.equal(data.tasks.find((t) => t.milestone === 'Configuration').status, 'in progress');
});

test('PM-only milestones are kept', () => {
  const data = fixture();
  put(data, '2026-11-02T03:00:00Z', fullCr({ segment: 'Go-Live', stage: 'GO-LIVE', status: 'Completed', closedAt: '2026-12-01' }));
  const i = data.initiatives[0];
  assert.equal(i.milestone, 'Live (Warranty Period)');
  i.milestone = 'Fully Live';
  put(data, '2026-12-20T03:00:00Z', fullCr({ segment: 'Go-Live', stage: 'GO-LIVE', status: 'Completed', closedAt: '2026-12-01', note: 'x' }));
  assert.equal(i.milestone, 'Fully Live');
});

test('validation and warnings', () => {
  const data = fixture();
  assert.throws(() => put(data, '2026-11-02T03:00:00Z', fullCr({ status: 'On Hold' })), /cr.status/);
  assert.throws(() => put(data, '2026-11-02T03:00:00Z', fullCr({ dateCreation: '' })), /cr.dateCreation/);
  assert.throws(() => applyCr(data, { cr: fullCr() }, 'full', CR1), /occurredAt/);
  assert.throws(() => applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: { status: 'Delayed' } }, 'partial', 'CR404'), (e) => e.status === 404);
  assert.throws(() => put(data, '2026-11-02T03:00:00Z', fullCr({ crId: 'CR000000999' })), /does not match/);
  assert.throws(() => applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: { ...fullCr(), crId: undefined } }, 'full', null), /crId/);
  assert.throws(() => put(data, '2026-11-02T03:00:00Z', fullCr({ progress: 140 })), /progress/);
  assert.throws(() => put(data, '2026-11-02T03:00:00Z', fullCr({ segments: [{ name: 'Prep', stages: [{ name: 'X', status: 'done' }] }] })), /status/);
  assert.throws(() => put(data, '2026-11-02T03:00:00Z', fullCr({ impactAreas: [{ name: 'no code' }] })), /impactAreas\[0\]\.code/);
  // A rejected message changes nothing (no captured option / user / module)
  assert.throws(() => put(data, '2026-11-02T03:00:00Z', fullCr({ moduleId: 'MD9', moduleName: 'Prod', priority: 'Urgent' })), /priority/);
  assert.equal(data.erpOptions.length, 0);
  assert.equal(data.users.length, 3);
  assert.ok(!data.erpModules.some((m) => m.id === 'MD9'));
  assert.equal(data.initiatives.length, 0);

  const r = put(data, '2026-11-02T03:00:00Z', fullCr({
    moduleId: 'MD000000009', moduleName: 'Sales', requesterDepartmentCode: 'ZZ', requesterEmail: 'gone@kpn-corp.com', stage: 'Odd',
  }));
  const codes = r.warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ['UNMAPPED_DEPARTMENT', 'UNMAPPED_MODULE', 'UNMAPPED_STAGE', 'USER_CREATED', 'USER_UNMAPPED']);
  assert.ok(data.erpModules.some((m) => m.id === 'MD000000009' && m.name === 'Sales'));
  assert.equal(data.initiatives[0].milestone, 'CR Created'); // default on create when the stage is unknown
});
