const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { start, stop, login, fakeDxing, sample, request, env } = require('./helpers');
const { Admin, Registration, Notification, EntryPass } = require('../src/models');
const { mockOutbox } = require('../src/providers/dxing');
const { parseQrPayload, qrPayload } = require('../src/utils/passTokens');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const submit = (body, key) => {
  const r = request(app).post('/api/public/registrations');
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};

async function submitAndGetId(over) {
  const res = await submit(sample(over));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const reg = await Registration.findOne({ regNo: res.body.regNo });
  return String(reg._id);
}

const act = (agent, id, action) => agent.post(`/api/admin/registrations/${id}/actions/${action}`).set(H).send({});

before(async () => {
  app = await start();
  admin = await login(app);
});

after(stop);

describe('public registration', () => {
  test('rejects invalid input with per-field messages', async () => {
    const res = await submit({ name: 'A', age: 5, mobile: '12345', email: 'nope', district: '', area: 'x' });
    assert.equal(res.status, 400);
    for (const f of ['name', 'age', 'mobile', 'email', 'district', 'area', 'unit']) assert.ok(res.body.fields[f], f);
  });

  test('name: letters and spaces only; numbers and special characters refused', async () => {
    const bad = ['Asha 2', 'R2D2', '12345', 'Mary-Anne', "D'Souza", 'K. P. Rahul', 'Asha!', 'Asha_Menon', 'Asha@Menon', '٣Asha'];
    for (const name of bad) {
      const r = await submit(sample({ name, mobile: '9000000101' }));
      assert.equal(r.status, 400, name);
      assert.ok(r.body.fields.name, name);
    }
    assert.match((await submit(sample({ name: 'Asha 2' }))).body.fields.name, /cannot contain numbers/);
    assert.match((await submit(sample({ name: 'Mary-Anne' }))).body.fields.name, /only letters and spaces/);

    // Extra spaces are trimmed and collapsed; letters in other scripts are fine.
    const ok = await submit(sample({ name: '   Mary    Anne   Joseph ', mobile: '9000000102' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.name, 'Mary Anne Joseph');
    assert.equal((await submit(sample({ name: 'അനു രാജ്', mobile: '9000000103' }))).status, 201);
  });

  test('age: digits only and within range; never coerced', async () => {
    for (const age of ['25abc', 'abc', '2.5', 25.5, '0x1F', '1e1', '-20', '', null, 9, 101, '101']) {
      const r = await submit(sample({ age, mobile: '9000000104' }));
      assert.equal(r.status, 400, String(age));
      assert.ok(r.body.fields.age, String(age));
    }
    assert.match((await submit(sample({ age: '25abc' }))).body.fields.age, /numbers only/);
    const ok = await submit(sample({ age: '42', mobile: '9000000105' }));
    assert.equal(ok.status, 201);
    assert.equal((await Registration.findOne({ regNo: ok.body.regNo })).age, 42);
  });

  test('mobile: letters, symbols, spaces and wrong lengths refused', async () => {
    const bad = [
      '98765abcde', '98765-43210', '(987) 6543210', '98765 43210', '+919876543210', '+91 98765 43210',
      '987654321', '98765432101', '09876543210', '919876543210', '5876543210', '98765.43210', '',
    ];
    for (const mobile of bad) {
      const r = await submit(sample({ mobile }));
      assert.equal(r.status, 400, mobile);
      assert.ok(r.body.fields.mobile, mobile);
    }
    assert.match((await submit(sample({ mobile: '98765abcde' }))).body.fields.mobile, /digits only/);
    assert.match((await submit(sample({ mobile: '+919876543210' }))).body.fields.mobile, /digits only/);
    assert.match((await submit(sample({ mobile: '987654321' }))).body.fields.mobile, /valid 10-digit mobile number/);
    assert.match((await submit(sample({ mobile: '5876543210' }))).body.fields.mobile, /Enter a valid mobile number/);
  });

  test('mobile: country code must come from the list and sets the length rule', async () => {
    for (const countryCode of ['+91', '999', 'IN', 'abc']) {
      const r = await submit(sample({ countryCode, mobile: '9000000120' }));
      assert.equal(r.status, 400, countryCode);
      assert.match(r.body.fields.countryCode, /country code/, countryCode);
    }
    // A UAE number is 9 digits; 10 digits is refused for that country.
    assert.match((await submit(sample({ countryCode: '971', mobile: '5012345678' }))).body.fields.mobile, /9-digit/);
  });

  test('mobile: stored in E.164 and sent to DXing with the country code', async () => {
    const cases = [
      [undefined, '9000000106', '+919000000106'],
      ['91', '9000000107', '+919000000107'],
      ['971', '501234567', '+971501234567'],
      ['974', '55123456', '+97455123456'],
    ];
    for (const [countryCode, mobile, e164] of cases) {
      const r = await submit(sample({ mobile, ...(countryCode ? { countryCode } : {}) }));
      assert.equal(r.status, 201, `${countryCode} ${mobile} ${JSON.stringify(r.body)}`);
      assert.equal((await Registration.findOne({ regNo: r.body.regNo })).mobile, e164);
    }
  });

  test('email format is validated', async () => {
    for (const email of ['plain', 'a@b', 'a@@b.com', 'a b@c.com', '@example.com']) {
      assert.equal((await submit(sample({ email, mobile: '9000000109' }))).status, 400, email);
    }
  });

  test('district must come from the list; area and unit are required', async () => {
    const r = await submit(sample({ district: 'Atlantis', area: ' ', unit: '' }));
    assert.equal(r.status, 400);
    assert.match(r.body.fields.district, /from the list/);
    assert.match(r.body.fields.area, /required/);
    assert.match(r.body.fields.unit, /required/);
    const ok = await submit(sample({ district: '  east DISTRICT ', mobile: '9000000110' }));
    assert.equal(ok.status, 201);
    assert.equal((await Registration.findOne({ regNo: ok.body.regNo })).district, 'East District');
  });

  test('public config lists the districts', async () => {
    const c = (await request(app).get('/api/public/config')).body;
    assert.deepEqual(c.districts, ['North District', 'East District', 'West District', 'South District']);
  });

  test('rejects unknown fields and filled honeypot', async () => {
    assert.equal((await submit(sample({ status: 'confirmed' }))).status, 400);
    assert.equal((await submit(sample({ website: 'spam' }))).status, 400);
  });

  test('saves as Submitted, normalises data and sends acknowledgement', async () => {
    const before = mockOutbox.length;
    const res = await submit(sample(), 'key-aaaaaaaaaaaaaaaa');
    assert.equal(res.status, 201);
    assert.match(res.body.regNo, /^REG-\d{5}$/);
    assert.equal(res.body.id, undefined, 'internal id not exposed');

    const reg = await Registration.findOne({ regNo: res.body.regNo });
    assert.equal(reg.status, 'submitted');
    assert.equal(reg.passStatus, 'not_generated');
    assert.equal(reg.mobile, '+919876543210');
    assert.equal(reg.email, 'asha@example.com');
    assert.equal(reg.statusHistory.length, 1);

    const n = await waitFor(() => Notification.findOne({ registration: reg._id, status: 'accepted' }));
    assert.equal(n.template, 'registration_submitted');
    const msg = mockOutbox.at(-1);
    assert.equal(mockOutbox.length, before + 1);
    assert.equal(msg.recipient, '919876543210');
    assert.match(msg.message, /not confirmed yet/);
    assert.doesNotMatch(msg.message, /is \*confirmed\*/);
  });

  test('same idempotency key returns the original without saving or messaging again', async () => {
    const count = await Registration.countDocuments();
    const sent = mockOutbox.length;
    const res = await submit(sample(), 'key-aaaaaaaaaaaaaaaa');
    assert.equal(res.status, 200);
    assert.equal(await Registration.countDocuments(), count);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(mockOutbox.length, sent);
  });

  test('same name + mobile is refused as a duplicate', async () => {
    const res = await submit(sample({ name: '  asha   MENON ', countryCode: '91', mobile: '9876543210' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'duplicate');
  });

  test('closed registration is refused', async () => {
    env.registrationOpen = false;
    try {
      assert.equal((await submit(sample({ mobile: '9000000001' }))).status, 403);
    } finally {
      env.registrationOpen = true;
    }
  });
});

describe('authentication', () => {
  test('admin API requires a session', async () => {
    assert.equal((await request(app).get('/api/admin/registrations')).status, 401);
    assert.equal((await request(app).get('/api/admin/stats')).status, 401);
  });

  test('wrong password is refused; account locks after repeated failures', async () => {
    const { username, password } = env.admin;
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post('/api/auth/login').set(H).send({ username, password: 'wrong-password' });
      assert.equal(r.status, 401);
    }
    const locked = await request(app).post('/api/auth/login').set(H).send({ username, password });
    assert.equal(locked.status, 423);
    await Admin.updateOne({ username }, { $set: { lockUntil: null } });
  });

  test('only the admin from .env can sign in', async () => {
    const wrongUser = await request(app).post('/api/auth/login').set(H).send({ username: 'helper', password: env.admin.password });
    assert.equal(wrongUser.status, 401);

    // A valid token for any other account in the database is refused.
    const other = await Admin.create({ username: 'helper', name: 'helper user', role: 'staff' });
    const cookie = (await request(app).post('/api/auth/login').set(H).send(env.admin)).headers['set-cookie'][0].split(';')[0];
    const { cs } = jwt.decode(cookie.split('=')[1]);
    const forged = jwt.sign({ sub: String(other._id), tv: 0, cs }, env.jwtSecret, { algorithm: 'HS256' });
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', `rms_session=${forged}`)).status, 401);
  });

  test('changing ADMIN_PASSWORD signs out existing sessions', async () => {
    const original = env.admin.password;
    try {
      env.admin.password = 'a-brand-new-password';
      assert.equal((await admin.get('/api/auth/me')).status, 401);
    } finally {
      env.admin.password = original;
    }
    assert.equal((await admin.get('/api/auth/me')).status, 200);
  });

  test('session cookie is httpOnly and SameSite=Strict', async () => {
    const r = await request(app).post('/api/auth/login').set(H).send(env.admin);
    const cookie = r.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(r.body.admin.passwordHash, undefined);
  });

  test('state-changing requests need the CSRF header', async () => {
    const id = await submitAndGetId({ mobile: '9000000002' });
    const r = await admin.post(`/api/admin/registrations/${id}/actions/confirm`).send({});
    assert.equal(r.status, 403);
  });

  test('logout revokes the session server-side', async () => {
    const agent = await login(app);
    const cookie = (await request(app).post('/api/auth/login').set(H).send(env.admin)).headers['set-cookie'][0].split(';')[0];
    assert.equal((await agent.get('/api/auth/me')).status, 200);
    assert.equal((await agent.post('/api/auth/logout').set(H)).status, 200);
    assert.equal((await agent.get('/api/auth/me')).status, 401);
    // A copy of the cookie taken before logout no longer works either.
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
    // Logout signs the one admin out everywhere; sign the shared agent back in.
    admin = await login(app);
  });
});

describe('workflow', () => {
  let id;

  before(async () => {
    id = await submitAndGetId({ name: 'Ravi Kumar', mobile: '9123456780', district: 'East District' });
  });

  test('there is no Pending step, and no reject or reopen action', async () => {
    for (const action of ['mark-pending', 'pending', 'reject', 'reopen']) {
      assert.equal((await act(admin, id, action)).status, 404, action);
    }
    assert.equal((await admin.get('/api/admin/registrations').query({ status: 'pending' })).status, 400);
    const filters = (await admin.get('/api/admin/filters')).body;
    assert.deepEqual(filters.statuses, ['submitted', 'confirmed']);
    assert.ok(!filters.passStatuses.includes('revoked'));
    assert.equal((await Registration.findById(id)).status, 'submitted');
  });

  test('confirm from Submitted: one pass, one confirmation and one pass message, even when clicked twice', async () => {
    const before = mockOutbox.length;
    const [a, b] = await Promise.all([act(admin, id, 'confirm'), act(admin, id, 'confirm')]);
    const ok = [a, b].filter((r) => r.status === 200);
    assert.equal(ok.length, 1, `${a.status} ${b.status}`);
    const body = ok[0].body;
    assert.equal(body.registration.status, 'confirmed');
    assert.equal(body.registration.passStatus, 'sent');
    assert.ok(body.registration.confirmedAt, 'confirmation time recorded');
    assert.equal(body.registration.confirmedByName, 'chief');
    assert.match(body.pass.passId, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(await EntryPass.countDocuments({ registration: id }), 1);

    const sent = mockOutbox.slice(before);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].type, 'text');
    assert.equal(sent[0].recipient, '919123456780');
    assert.match(sent[0].message, /is \*confirmed\*/);
    assert.equal(sent[1].type, 'media');
    assert.equal(sent[1].media_type, 'image');
    assert.match(sent[1].message, new RegExp(body.pass.passId));
    assert.ok(sent[1].media_url.startsWith('http://public.example/api/passes/'));

    const reg = await Registration.findById(id);
    assert.equal(reg.statusHistory.map((h) => h.to).join(','), 'submitted,confirmed');
  });

  test('confirming again is refused and sends nothing', async () => {
    const before = mockOutbox.length;
    const r = await act(admin, id, 'confirm');
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'invalid_transition');
    assert.equal(mockOutbox.length, before);
    assert.equal(await EntryPass.countDocuments({ registration: id }), 1);
    assert.equal(await Notification.countDocuments({ registration: id, template: 'registration_confirmed' }), 1);
  });

  test('signed image link serves the PNG; tampered or expired links do not', async () => {
    const url = new URL(mockOutbox.at(-1).media_url);
    const path = url.pathname + url.search;
    const ok = await request(app).get(path);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'image/png');
    assert.equal(ok.headers['cache-control'], 'private, no-store');
    assert.ok(ok.body.length > 10000);

    const bad = path.replace(/sig=[^&]+/, 'sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal((await request(app).get(bad)).status, 404);
    const expired = path.replace(/exp=\d+/, 'exp=1000');
    assert.equal((await request(app).get(expired)).status, 404);
    const pass = await EntryPass.findOne({ registration: id });
    assert.equal((await request(app).get(`/api/passes/${pass.passId}/image`)).status, 404);
  });

  test('admin can view and download the pass image; anonymous users cannot', async () => {
    const res = await admin.get(`/api/admin/registrations/${id}/pass.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.match(res.headers['content-disposition'], /^inline/);
    const dl = await admin.get(`/api/admin/registrations/${id}/pass.png?download=1`);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="entry-pass-/);
    assert.equal((await request(app).get(`/api/admin/registrations/${id}/pass.png`)).status, 401);
  });

  test('generate is refused when a pass exists; resend has a cooldown', async () => {
    assert.equal((await admin.post(`/api/admin/registrations/${id}/pass/generate`).set(H)).status, 409);
    const early = await admin.post(`/api/admin/registrations/${id}/pass/resend`).set(H);
    assert.equal(early.status, 429);

    await Notification.collection.updateMany({ registration: new mongoose.Types.ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - 120000) } });
    const before = mockOutbox.length;
    const res = await admin.post(`/api/admin/registrations/${id}/pass/resend`).set(H);
    assert.equal(res.status, 200);
    assert.equal(mockOutbox.length, before + 1);
    assert.equal(await EntryPass.countDocuments({ registration: id }), 1);
  });

  test('QR verification accepts the signed code and rejects forgeries', async () => {
    const pass = await EntryPass.findOne({ registration: id });
    const code = qrPayload(pass.passId, pass.version);
    assert.deepEqual(parseQrPayload(code), { passId: pass.passId, version: 1, signed: true });

    const good = await admin.post('/api/admin/passes/verify').set(H).send({ code });
    assert.equal(good.body.valid, true);
    assert.equal(good.body.registration.name, 'Ravi Kumar');

    const forged = `${pass.passId}.1.${'x'.repeat(32)}`;
    assert.equal((await admin.post('/api/admin/passes/verify').set(H).send({ code: forged })).body.reason, 'invalid_code');
  });

});

describe('DXing failures and retry', () => {
  let dx;
  before(async () => {
    dx = await fakeDxing();
    dx.use();
  });
  after(async () => {
    dx.restore();
    await dx.close();
  });

  test('sends the expected payload to DXing', async () => {
    const id = await submitAndGetId({ name: 'Live Test', mobile: '9111111111' });
    await waitFor(() => Notification.findOne({ registration: id, status: 'accepted' }));
    const req = dx.received.at(-1);
    assert.equal(req.url, '/api/send/whatsapp');
    assert.equal(req.body.secret, 'fake-secret');
    assert.equal(req.body.account, 'fake-account');
    assert.equal(req.body.recipient, '919111111111');
    assert.equal(req.body.type, 'text');
  });

  test('failed pass send keeps the generated pass and can be retried', async () => {
    const id = await submitAndGetId({ name: 'Fail Case', mobile: '9222222222' });
    await waitFor(() => Notification.findOne({ registration: id, status: 'accepted' }));

    dx.state.body = { status: 400, message: 'Invalid account' };
    const res = await act(admin, id, 'confirm');
    assert.equal(res.status, 200);
    assert.equal(res.body.registration.status, 'confirmed');
    assert.equal(res.body.registration.passStatus, 'send_failed');
    assert.ok(res.body.pass.passId, 'pass kept');
    assert.ok(res.body.messages.every((m) => !m.ok));
    assert.match(res.body.messages[1].error, /Invalid account/);
    assert.doesNotMatch(JSON.stringify(res.body), /fake-secret/);

    const failed = res.body.notifications.find((n) => n.template === 'entry_pass');
    assert.equal(failed.status, 'failed');

    dx.state.body = { status: 200, message: 'ok' };
    const retry = await admin.post(`/api/admin/registrations/${id}/notifications/${failed.id}/retry`).set(H);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.registration.passStatus, 'sent');
    const retried = retry.body.notifications.find((n) => n.id === failed.id);
    assert.equal(retried.status, 'accepted');
    assert.equal(retried.attempts, 2);

    // Already accepted: a second retry is refused, no duplicate message.
    const again = await admin.post(`/api/admin/registrations/${id}/notifications/${failed.id}/retry`).set(H);
    assert.equal(again.status, 409);
    assert.equal(await EntryPass.countDocuments({ registration: id }), 1);
  });

  test('provider HTTP error and unreachable provider are reported, not thrown', async () => {
    const id = await submitAndGetId({ name: 'Down Case', mobile: '9333333333' });
    await waitFor(() => Notification.findOne({ registration: id, status: 'accepted' }));
    dx.state.status = 503;
    const res = await act(admin, id, 'confirm');
    assert.equal(res.status, 200);
    assert.equal(res.body.registration.status, 'confirmed');
    assert.match(res.body.messages[0].error, /HTTP 503/);
    assert.equal(res.body.registration.passStatus, 'send_failed');
    dx.state.status = 200;

    // Resend works right after a failure (no cooldown) and keeps the same pass.
    const passId = res.body.pass.passId;
    const resend = await admin.post(`/api/admin/registrations/${id}/pass/resend`).set(H);
    assert.equal(resend.status, 200);
    assert.equal(resend.body.registration.passStatus, 'sent');
    assert.equal(resend.body.pass.passId, passId);
    assert.equal(await EntryPass.countDocuments({ registration: id }), 1);

    env.dxing.baseUrl = 'http://127.0.0.1:1/api';
    const id2 = await submitAndGetId({ name: 'Unreachable', mobile: '9444444444' });
    const n = await waitFor(() => Notification.findOne({ registration: id2, status: 'failed' }));
    assert.match(n.lastError, /Could not reach/);
    dx.use();
  });
});

describe('listing', () => {
  before(async () => {
    const people = [
      ['Zara Ali', 41, '9500000001', 'West District', 'Hill Area', 'Unit 1'],
      ['Bilal Khan', 22, '9500000002', 'West District', 'River Area', 'Unit 2'],
      ['Chitra Nair', 35, '9500000003', 'South District', 'Hill Area', 'Unit 1'],
    ];
    for (const [name, age, mobile, district, area, unit] of people) {
      await submitAndGetId({ name, age, mobile, district, area, unit, email: `${name.split(' ')[0].toLowerCase()}@mail.test` });
    }
  });

  const list = (q) => admin.get('/api/admin/registrations').query(q);

  test('search by name, mobile digits and email', async () => {
    assert.equal((await list({ search: 'zara' })).body.items[0].name, 'Zara Ali');
    assert.equal((await list({ search: '95000 00002' })).body.items[0].name, 'Bilal Khan');
    assert.equal((await list({ search: 'chitra@mail' })).body.items[0].name, 'Chitra Nair');
  });

  test('regex characters in search are treated literally', async () => {
    const r = await list({ search: '.*' });
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
  });

  test('filters by district, area, unit, status, pass status and date', async () => {
    assert.equal((await list({ district: 'west district' })).body.total, 2);
    assert.equal((await list({ district: 'West District', area: 'Hill Area' })).body.total, 1);
    assert.equal((await list({ unit: 'Unit 1' })).body.total, 2);
    const confirmed = (await list({ status: 'confirmed' })).body.items;
    assert.ok(confirmed.length >= 1 && confirmed.every((i) => i.status === 'confirmed'));
    assert.ok((await list({ passStatus: 'sent' })).body.items.every((i) => i.passStatus === 'sent'));
    const future = new Date(Date.now() + 86400000).toISOString();
    assert.equal((await list({ from: future })).body.total, 0);
    assert.equal((await list({ from: 'not-a-date' })).status, 400);
  });

  test('district filter options ignore unlisted stored values', async () => {
    // Older records were saved before the district had to come from the list.
    const id = await submitAndGetId({ name: 'Old Record', mobile: '9500000009' });
    await Registration.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { district: 'calicut' } });
    try {
      const f = (await admin.get('/api/admin/filters')).body;
      assert.deepEqual(f.districts, ['North District', 'East District', 'West District', 'South District']);
    } finally {
      await Registration.deleteOne({ _id: id });
    }
  });

  test('sorts by name, age, district and status', async () => {
    const names = (await list({ sort: 'name', dir: 'asc', limit: 100 })).body.items.map((i) => i.name.toLowerCase());
    assert.deepEqual(names, [...names].sort());
    const ages = (await list({ sort: 'age', dir: 'desc', limit: 100 })).body.items.map((i) => i.age);
    assert.deepEqual(ages, [...ages].sort((a, b) => b - a));
    const d = (await list({ sort: 'district', dir: 'asc', limit: 100 })).body.items.map((i) => i.district);
    assert.deepEqual(d, [...d].sort());
    const order = ['submitted', 'confirmed'];
    const s = (await list({ sort: 'status', dir: 'asc', limit: 100 })).body.items.map((i) => order.indexOf(i.status));
    assert.deepEqual(s, [...s].sort((a, b) => a - b));
  });

  test('paginates', async () => {
    const p1 = (await list({ limit: 2, page: 1 })).body;
    const p2 = (await list({ limit: 2, page: 2 })).body;
    assert.equal(p1.items.length, 2);
    assert.equal(p1.pages, Math.ceil(p1.total / 2));
    assert.notEqual(p1.items[0].id, p2.items[0].id);
    assert.equal((await list({ limit: 1000 })).status, 400);
  });

  test('filter options and stats', async () => {
    const f = (await admin.get('/api/admin/filters').query({ district: 'West District' })).body;
    assert.deepEqual(f.districts, ['North District', 'East District', 'West District', 'South District']);
    assert.deepEqual(f.areas.sort(), ['Hill Area', 'River Area']);
    const s = (await admin.get('/api/admin/stats')).body;
    assert.equal(s.total, await Registration.countDocuments());
    assert.equal(s.awaitingConfirmation, await Registration.countDocuments({ status: 'submitted' }));
    assert.equal(s.confirmed, await Registration.countDocuments({ status: 'confirmed' }));
    assert.equal(s.passesSent, await Registration.countDocuments({ passStatus: 'sent' }));
    assert.equal(s.awaitingConfirmation + s.confirmed, s.total);
    assert.equal(s.byStatus.pending, undefined);
  });
});
