// Event day check-in and check-out: each pass scans once per action, in
// order, also when two gates scan it at the same moment; admin undo; the
// lists, head counts and exports.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { start, stop, login, sampleV3, request, env } = require('./helpers');
const { Registration, EntryPass } = require('../src/models');
const { qrPayload } = require('../src/utils/passTokens');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };

let mobileSeq = 9876500000;
async function register(over = {}) {
  mobileSeq += 1;
  const res = await request(app).post('/api/public/registrations').send(sampleV3({ mobile: String(mobileSeq), ...over }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const reg = await Registration.findOne({ regNo: res.body.regNo });
  const pass = await EntryPass.findOne({ registration: reg._id });
  return { id: String(reg._id), regNo: reg.regNo, passId: pass.passId, code: qrPayload(pass.passId, pass.version) };
}

const scan = (code, action) => admin.post('/api/admin/attendance/scan').set(H).send({ code, action });
const undo = (id, action) => admin.post(`/api/admin/attendance/${id}/undo`).set(H).send({ action });
const list = (query) => admin.get(`/api/admin/attendance?${new URLSearchParams(query)}`);

before(async () => {
  app = await start();
  admin = await login(app);
});

after(stop);

describe('check-in', () => {
  test('a pass checks in once; a second scan reports the first time', async () => {
    const p = await register({ name: 'First Scan' });
    const first = await scan(p.code, 'in');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.result, 'ok');
    assert.equal(first.body.action, 'in');
    assert.equal(first.body.registration.name, 'First Scan');
    assert.ok(first.body.registration.checkedInAt);
    assert.equal(first.body.registration.checkedInByName, env.admin.username);
    assert.equal(first.body.registration.checkedOutAt, null);

    const again = await scan(p.code, 'in');
    assert.equal(again.body.result, 'already');
    assert.equal(again.body.registration.checkedInAt, first.body.registration.checkedInAt);
  });

  test('simultaneous scans of one pass record exactly one check-in', async () => {
    const p = await register();
    const results = await Promise.all(Array.from({ length: 8 }, () => scan(p.code, 'in')));
    const outcomes = results.map((r) => r.body.result);
    assert.equal(outcomes.filter((r) => r === 'ok').length, 1, outcomes.join());
    assert.equal(outcomes.filter((r) => r === 'already').length, 7, outcomes.join());
    const times = new Set(results.map((r) => r.body.registration.checkedInAt));
    assert.equal(times.size, 1);
  });

  test('a typed pass ID checks in like the QR code', async () => {
    const p = await register();
    assert.equal((await scan(p.passId.toLowerCase(), 'in')).body.result, 'ok');
    assert.equal((await scan(p.code, 'in')).body.result, 'already');
  });

  test('registrations saved before attendance existed can check in', async () => {
    const p = await register();
    await Registration.collection.updateOne(
      { regNo: p.regNo },
      { $unset: { checkedInAt: '', checkedInBy: '', checkedInByName: '', checkedOutAt: '', checkedOutBy: '', checkedOutByName: '' } }
    );
    assert.equal((await scan(p.code, 'out')).body.result, 'not_checked_in');
    assert.equal((await scan(p.code, 'in')).body.result, 'ok');
    assert.equal((await scan(p.code, 'out')).body.result, 'ok');
  });

  test('invalid, forged, outdated and cancelled codes are refused without recording anything', async () => {
    const p = await register();
    const forged = `${p.passId}.1.${'x'.repeat(32)}`;
    const cases = [
      ['', 'invalid_code'],
      ['hello', 'invalid_code'],
      [forged, 'invalid_code'],
      ['AAAA-AAAA-AAAA', 'not_found'],
      [qrPayload(p.passId, 2), 'outdated'],
    ];
    for (const [code, reason] of cases) {
      const res = await scan(code, 'in');
      assert.equal(res.body.result, 'invalid', code);
      assert.equal(res.body.reason, reason, code);
      assert.ok(res.body.message, code);
    }

    await EntryPass.updateOne({ passId: p.passId }, { $set: { status: 'revoked' } });
    const revoked = await scan(p.code, 'in');
    assert.equal(revoked.body.result, 'invalid');
    assert.equal(revoked.body.reason, 'revoked');
    await EntryPass.updateOne({ passId: p.passId }, { $set: { status: 'active' } });

    assert.equal((await Registration.findById(p.id)).checkedInAt, null);
  });

  test('scanning needs a signed-in admin and a valid action', async () => {
    const p = await register();
    assert.equal((await request(app).post('/api/admin/attendance/scan').set(H).send({ code: p.code, action: 'in' })).status, 401);
    assert.equal((await admin.post('/api/admin/attendance/scan').send({ code: p.code, action: 'in' })).status, 403);
    assert.equal((await scan(p.code, 'sideways')).status, 400);
    assert.equal((await scan(p.code)).status, 400);
    assert.equal((await Registration.findById(p.id)).checkedInAt, null);
  });
});

describe('check-out', () => {
  test('needs a check-in first, then checks out once', async () => {
    const p = await register();
    const early = await scan(p.code, 'out');
    assert.equal(early.body.result, 'not_checked_in');
    assert.equal(early.body.registration.checkedOutAt, null);

    await scan(p.code, 'in');
    const out = await scan(p.code, 'out');
    assert.equal(out.body.result, 'ok');
    assert.ok(out.body.registration.checkedOutAt);
    assert.equal(out.body.registration.checkedOutByName, env.admin.username);

    const again = await scan(p.code, 'out');
    assert.equal(again.body.result, 'already');
    assert.equal(again.body.registration.checkedOutAt, out.body.registration.checkedOutAt);
    // Checking in again after leaving is refused too.
    assert.equal((await scan(p.code, 'in')).body.result, 'already');
  });

  test('simultaneous check-out scans record exactly one', async () => {
    const p = await register();
    await scan(p.code, 'in');
    const outcomes = (await Promise.all(Array.from({ length: 6 }, () => scan(p.code, 'out')))).map((r) => r.body.result);
    assert.equal(outcomes.filter((r) => r === 'ok').length, 1, outcomes.join());
  });
});

describe('undo', () => {
  test('clears a check-out, then a check-in, so the pass scans again', async () => {
    const p = await register();
    await scan(p.code, 'in');
    await scan(p.code, 'out');

    // A check-in cannot be undone while the person is checked out.
    const blocked = await undo(p.id, 'in');
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /check-out first/);

    const outUndone = await undo(p.id, 'out');
    assert.equal(outUndone.status, 200, JSON.stringify(outUndone.body));
    assert.equal(outUndone.body.registration.checkedOutAt, null);
    assert.ok(outUndone.body.registration.checkedInAt);

    const inUndone = await undo(p.id, 'in');
    assert.equal(inUndone.status, 200);
    assert.equal(inUndone.body.registration.checkedInAt, null);
    assert.equal(inUndone.body.registration.checkedInByName, null);

    assert.equal((await undo(p.id, 'in')).status, 409);
    assert.equal((await undo(p.id, 'out')).status, 409);
    assert.equal((await scan(p.code, 'in')).body.result, 'ok');
  });

  test('rejects unknown registrations and actions', async () => {
    assert.equal((await undo('000000000000000000000000', 'in')).status, 404);
    assert.equal((await undo('not-an-id', 'in')).status, 400);
    const p = await register();
    assert.equal((await undo(p.id, 'both')).status, 400);
  });
});

describe('lists, head counts and exports', () => {
  let inside;
  let left;
  let never;

  before(async () => {
    await Registration.deleteMany({});
    await EntryPass.deleteMany({});
    inside = await register({ name: 'Zara Inside', district: 'East District', childrenCount: 2, children: [{ name: 'Kid One', age: 4 }, { name: 'Kid Two', age: 7 }] });
    left = await register({ name: 'Anu Left', district: 'West District', childrenCount: 1, children: [{ name: 'Kid Three', age: 9 }] });
    never = await register({ name: 'Never Came' });
    await scan(left.code, 'in');
    await scan(inside.code, 'in');
    await scan(left.code, 'out');
  });

  test('the check-in list shows everyone checked in, newest first', async () => {
    const res = await list({ type: 'in' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.total, 2);
    assert.deepEqual(res.body.items.map((r) => r.name), ['Zara Inside', 'Anu Left']);

    const oldest = await list({ type: 'in', dir: 'asc' });
    assert.deepEqual(oldest.body.items.map((r) => r.name), ['Anu Left', 'Zara Inside']);
    const byName = await list({ type: 'in', sort: 'name', dir: 'asc' });
    assert.deepEqual(byName.body.items.map((r) => r.name), ['Anu Left', 'Zara Inside']);
  });

  test('filters by inside / left, search and district', async () => {
    assert.deepEqual((await list({ type: 'in', state: 'inside' })).body.items.map((r) => r.name), ['Zara Inside']);
    assert.deepEqual((await list({ type: 'in', state: 'left' })).body.items.map((r) => r.name), ['Anu Left']);
    assert.deepEqual((await list({ type: 'in', search: 'zara' })).body.items.map((r) => r.name), ['Zara Inside']);
    assert.deepEqual((await list({ type: 'in', district: 'west district' })).body.items.map((r) => r.name), ['Anu Left']);
    assert.equal((await list({ type: 'in', search: 'never' })).body.total, 0);
  });

  test('the check-out list shows only those checked out', async () => {
    const res = await list({ type: 'out' });
    assert.deepEqual(res.body.items.map((r) => r.name), ['Anu Left']);
    assert.ok(res.body.items[0].checkedOutAt);
  });

  test('rejects a missing or unknown list type', async () => {
    assert.equal((await list({})).status, 400);
    assert.equal((await list({ type: 'all' })).status, 400);
    assert.equal((await list({ type: 'in', sort: 'createdAt' })).status, 400);
  });

  test('head counts include the children registered with each person', async () => {
    const res = await admin.get('/api/admin/attendance/stats');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      registrations: 3,
      checkedIn: 2,
      checkedInChildren: 3,
      checkedOut: 1,
      checkedOutChildren: 1,
      inside: 1,
      insideChildren: 2,
    });
  });

  test('Excel export has the check-in and check-out times', async () => {
    const res = await admin
      .get('/api/admin/attendance/export?type=in&format=xlsx&tz=Asia/Kolkata')
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /check-ins-\d{4}-\d{2}-\d{2}\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('Check-ins');
    const header = ws.getRow(1).values.slice(1);
    for (const h of ['Checked in', 'Checked in by', 'Checked out', 'Checked out by']) assert.ok(header.includes(h), h);
    assert.equal(ws.rowCount, 3);
    const col = (h) => header.indexOf(h) + 1;
    const anu = ws.getRow(3);
    assert.equal(anu.getCell(col('Name')).value, 'Anu Left');
    assert.ok(anu.getCell(col('Checked in')).value instanceof Date);
    assert.ok(anu.getCell(col('Checked out')).value instanceof Date);
    assert.equal(anu.getCell(col('Checked in by')).value, env.admin.username);
    assert.ok(!ws.getRow(2).getCell(col('Checked out')).value);
  });

  test('PDF export of the check-out list', async () => {
    const res = await admin.get('/api/admin/attendance/export?type=out&format=pdf').buffer(true);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'], /check-outs-\d{4}-\d{2}-\d{2}\.pdf/);
    assert.equal(res.body.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal((await admin.get('/api/admin/attendance/export?type=out&format=csv')).status, 400);
  });

  test('a registration that never came appears in neither list', async () => {
    const ids = [...(await list({ type: 'in' })).body.items, ...(await list({ type: 'out' })).body.items].map((r) => r.id);
    assert.ok(!ids.includes(never.id));
  });
});
