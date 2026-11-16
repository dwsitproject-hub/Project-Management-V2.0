// Unit tests for the ERP CR sync mapping (no database needed).
//   node --test tests/erp-cr-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapStatus, mapPriority, mapMilestone, htmlToText, crNameFrom, toPmDate, nameFromEmail } from '../backend/services/erp-cr-mapper.js';
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

test('milestone mapping by (segment, stage)', () => {
  assert.equal(mapMilestone('preparation', '\tuser initation'), 'User Initiate');
  assert.equal(mapMilestone('Preparation', 'CR Signed – Section 2'), 'CR Signed sec 2');
  assert.equal(mapMilestone('FSD Creation & Approval', 'Developer Review'), 'FSD');
  assert.equal(mapMilestone('Development and SIT', 'SIT'), 'SIT');
  assert.equal(mapMilestone('Development and SIT', 'Extended Development'), 'Development - Extended');
  assert.equal(mapMilestone('Development and SIT', 'Update FSD Change Request'), 'Signed Changes');
  assert.equal(mapMilestone('UAT', 'Update FSD Change Request'), 'UAT');
  assert.equal(mapMilestone('UAT', 'Transport'), 'UAT');
  assert.equal(mapMilestone('GO-Live', 'GO-LIVE'), 'Live (Warranty Period)');
  assert.equal(mapMilestone('Preparation', 'Unknown stage'), null);
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
      { id: 'app-fico', systemName: 'SAP FICO', externalIds: ['FI', 'CO'] },
      { id: 'app-nonfico', systemName: 'SAP NON FICO', externalIds: ['MM'] },
    ],
    erpModules: [{ id: 'FI', name: 'Finance', isActive: true }, { id: 'MM', name: 'Materials', isActive: true }],
    erpOptions: [],
  };
}

const fullCr = (over = {}) => ({
  ticketNumber: '#ERPO1', crId: 'CR000000001', type: 'Change Request', projectType: false,
  changeRequest: '<p>Add vendor tax field</p>', note: 'Urgent for month end',
  moduleId: 'FI', tCode: 'ZMM001', functionalDepartment: 'SAP FI', requesterDepartmentCode: 'ap1',
  ownership: { code: 'OWN1', name: 'Finance' }, impactArea: { code: 'IA1', name: 'Payables' },
  priority: 'High', requesterEmail: 'REQ@kpn-corp.com', functionalEmail: 'fun.ctional@kpn-corp.com',
  deptHeadEmail: 'dept.head@kpn-corp.com', deptHeadName: 'Dept Head',
  dateCreation: '2026-11-02', targetResolved: '2026-12-15', createdAt: '2026-11-02T02:10:00Z', closedAt: null,
  status: 'In Progress', segment: 'Preparation', stage: 'CR Creation', crReference: null,
  ...over,
});

test('PUT creates a CR with mapped fields', () => {
  const data = fixture();
  const r = applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr() }, 'full', '#ERPO1');
  assert.equal(r.action, 'created');
  const i = data.initiatives[0];
  assert.equal(i.type, 'CR');
  assert.equal(i.name, 'Add vendor tax field');
  assert.equal(i.description, 'Urgent for month end\n\nAdd vendor tax field');
  assert.equal(i.remark, 'Urgent for month end');
  assert.deepEqual(i.externalIds, ['#ERPO1']);
  assert.equal(i.externalSource, 'ERP');
  assert.equal(i.status, 'On Track');
  assert.equal(i.milestone, 'CR Created');
  assert.equal(i.priority, 'P0');
  assert.equal(i.departmentId, 'd-ap');
  assert.deepEqual(i.systemImpactedIds, ['app-fico']);
  assert.equal(i.businessOwnerId, 'u-req');
  assert.deepEqual(i.businessUserIds, ['u-req']);
  assert.equal(i.itPicId, 'u-fun');
  assert.equal(i.planStartDate, '2026-11-02');
  assert.equal(i.planEndDate, '2026-12-15');
  assert.equal(i.startDate, '2026-11-02');
  assert.equal(i.ownershipCode, 'OWN1');
  assert.equal(data.erpOptions.length, 2);
  assert.match(i.ticket, /^CR\d{11}$/);
  assert.equal(data.tasks.length, 10);
  assert.equal(data.changeRequests.length, 1);
  // Dept Head created as an inactive user
  const head = data.users.find((u) => u.email === 'dept.head@kpn-corp.com');
  assert.ok(head);
  assert.equal(head.active, false);
  assert.equal(head.name, 'Dept Head');
  assert.deepEqual(i.itManagerIds, [head.id]);
  assert.ok(r.warnings.some((w) => w.code === 'USER_CREATED'));
});

test('stale and repeated messages', () => {
  const data = fixture();
  applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr() }, 'full', '#ERPO1');
  const stale = applyCr(data, { occurredAt: '2026-11-02T02:00:00Z', cr: fullCr({ status: 'Cancelled' }) }, 'full', 'ERPO1');
  assert.equal(stale.action, 'ignored_stale');
  assert.equal(data.initiatives[0].status, 'On Track');
  const same = applyCr(data, { occurredAt: '2026-11-02T04:00:00Z', cr: fullCr() }, 'full', '#erpo1');
  assert.equal(same.action, 'unchanged');
  assert.equal(data.initiatives.length, 1);
  assert.equal(data.users.filter((u) => u.email === 'dept.head@kpn-corp.com').length, 1);
});

test('PATCH updates only what is sent and records history; tasks follow', () => {
  const data = fixture();
  applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr() }, 'full', '#ERPO1');
  const r = applyCr(data, { occurredAt: '2026-11-10T03:00:00Z', cr: { segment: 'Development and SIT', stage: 'SIT', status: 'Delayed' } }, 'partial', '#ERPO1');
  assert.equal(r.action, 'updated');
  assert.deepEqual(r.changedFields.sort(), ['milestone', 'status']);
  const i = data.initiatives[0];
  assert.equal(i.milestone, 'SIT');
  assert.equal(i.status, 'Delayed');
  assert.equal(i.priority, 'P0'); // untouched
  const done = data.tasks.filter((t) => t.status === 'done').map((t) => t.milestone);
  assert.deepEqual(done, ['User Initiate', 'CR Created', 'CR Signed sec 2', 'CR Signed Sec 3', 'FSD', 'Development']);
  assert.equal(data.changeHistory.at(-1).changedBy, 'ERP Integration');
});

test('PM-only milestones are kept', () => {
  const data = fixture();
  applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr({ segment: 'GO-Live', stage: 'GO-LIVE', status: 'Completed', closedAt: '2026-12-01' }) }, 'full', '#ERPO1');
  const i = data.initiatives[0];
  assert.equal(i.milestone, 'Live (Warranty Period)');
  i.milestone = 'Fully Live'; // set in PM after the warranty period
  applyCr(data, { occurredAt: '2026-12-20T03:00:00Z', cr: fullCr({ segment: 'GO-Live', stage: 'GO-LIVE', status: 'Completed', closedAt: '2026-12-01', note: 'x' }) }, 'full', '#ERPO1');
  assert.equal(i.milestone, 'Fully Live');
});

test('validation and warnings', () => {
  const data = fixture();
  assert.throws(() => applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr({ status: 'On Hold' }) }, 'full', '#ERPO1'), /cr.status/);
  assert.throws(() => applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr({ functionalEmail: '' }) }, 'full', '#ERPO1'), /cr.functionalEmail/);
  assert.throws(() => applyCr(data, { cr: fullCr() }, 'full', '#ERPO1'), /occurredAt/);
  assert.throws(() => applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: { status: 'Delayed' } }, 'partial', '#NOPE'), (e) => e.status === 404);
  assert.throws(() => applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr({ ticketNumber: '#OTHER' }) }, 'full', '#ERPO1'), /does not match/);
  // A rejected message changes nothing (no captured option / user / module)
  assert.throws(() => applyCr(data, { occurredAt: '2026-11-02T03:00:00Z', cr: fullCr({ moduleId: 'PP', moduleName: 'Prod', priority: 'Urgent' }) }, 'full', '#ERPO1'), /priority/);
  assert.equal(data.erpOptions.length, 0);
  assert.equal(data.users.length, 3);
  assert.ok(!data.erpModules.some((m) => m.id === 'PP'));
  const r = applyCr(data, {
    occurredAt: '2026-11-02T03:00:00Z',
    cr: fullCr({ moduleId: 'SD', moduleName: 'Sales', requesterDepartmentCode: 'ZZ', requesterEmail: 'gone@kpn-corp.com', stage: 'Odd' }),
  }, 'full', '#ERPO1');
  const codes = r.warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ['UNMAPPED_DEPARTMENT', 'UNMAPPED_MODULE', 'UNMAPPED_STAGE', 'USER_CREATED', 'USER_UNMAPPED']);
  assert.ok(data.erpModules.some((m) => m.id === 'SD' && m.name === 'Sales')); // captured
  assert.equal(data.initiatives[0].milestone, 'CR Created'); // default on create when stage unknown
});
