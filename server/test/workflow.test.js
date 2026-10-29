// Public registration, the entry pass every registration gets at once,
// admin sign-in, the admin pass endpoints and the registration list.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { start, stop, login, spaces, TEST_PHOTO, sampleV3, legacyRegistration, pngSize, request, env } = require('./helpers');
const { Admin, Registration, EntryPass } = require('../src/models');
const { parseQrPayload, qrPayload } = require('../src/utils/passTokens');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PASS_ID = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;
const CDN_PASS_URL = /^https:\/\/cdn\.test\.example\/TEST\/passes\/[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-v1-[a-f0-9]{32}\.png$/;

const submit = (body, key) => {
  const r = request(app).post('/api/public/registrations');
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};

async function submitAndGetId(over) {
  const res = await submit(sampleV3(over));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const reg = await Registration.findOne({ regNo: res.body.regNo });
  return String(reg._id);
}

before(async () => {
  app = await start();
  admin = await login(app);
});

after(stop);

describe('public registration', () => {
  test('rejects invalid input with per-field messages; area and unit are not required but the photo is', async () => {
    const res = await submit(sampleV3({ name: 'A', age: 5, mobile: '12345', email: 'nope', district: '', place: '', photo: '' }));
    assert.equal(res.status, 400);
    for (const f of ['name', 'age', 'mobile', 'email', 'district', 'place', 'photo']) assert.ok(res.body.fields[f], f);
    assert.equal(res.body.fields.area, undefined);
    assert.equal(res.body.fields.unit, undefined);
  });

  test('name: letters and spaces only; numbers and special characters refused', async () => {
    const bad = ['Asha 2', 'R2D2', '12345', 'Mary-Anne', "D'Souza", 'K. P. Rahul', 'Asha!', 'Asha_Menon', 'Asha@Menon', '٣Asha'];
    for (const name of bad) {
      const r = await submit(sampleV3({ name, mobile: '9000000101' }));
      assert.equal(r.status, 400, name);
      assert.ok(r.body.fields.name, name);
    }
    assert.match((await submit(sampleV3({ name: 'Asha 2' }))).body.fields.name, /cannot contain numbers/);
    assert.match((await submit(sampleV3({ name: 'Mary-Anne' }))).body.fields.name, /only letters and spaces/);

    // Extra spaces are trimmed and collapsed; letters in other scripts are fine.
    const ok = await submit(sampleV3({ name: '   Mary    Anne   Joseph ', mobile: '9000000102' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.name, 'Mary Anne Joseph');
    assert.equal((await submit(sampleV3({ name: 'അനു രാജ്', mobile: '9000000103' }))).status, 201);
  });

  test('age: digits only and within range; never coerced', async () => {
    for (const age of ['25abc', 'abc', '2.5', 25.5, '0x1F', '1e1', '-20', '', null, 9, 101, '101']) {
      const r = await submit(sampleV3({ age, mobile: '9000000104' }));
      assert.equal(r.status, 400, String(age));
      assert.ok(r.body.fields.age, String(age));
    }
    assert.match((await submit(sampleV3({ age: '25abc' }))).body.fields.age, /numbers only/);
    const ok = await submit(sampleV3({ age: '42', mobile: '9000000105' }));
    assert.equal(ok.status, 201);
    assert.equal((await Registration.findOne({ regNo: ok.body.regNo })).age, 42);
  });

  test('mobile: letters, symbols, spaces and wrong lengths refused', async () => {
    const bad = [
      '98765abcde', '98765-43210', '(987) 6543210', '98765 43210', '+919876543210', '+91 98765 43210',
      '987654321', '98765432101', '09876543210', '919876543210', '5876543210', '98765.43210', '',
    ];
    for (const mobile of bad) {
      const r = await submit(sampleV3({ mobile }));
      assert.equal(r.status, 400, mobile);
      assert.ok(r.body.fields.mobile, mobile);
    }
    assert.match((await submit(sampleV3({ mobile: '98765abcde' }))).body.fields.mobile, /digits only/);
    assert.match((await submit(sampleV3({ mobile: '+919876543210' }))).body.fields.mobile, /digits only/);
    assert.match((await submit(sampleV3({ mobile: '987654321' }))).body.fields.mobile, /valid 10-digit mobile number/);
    assert.match((await submit(sampleV3({ mobile: '5876543210' }))).body.fields.mobile, /Enter a valid mobile number/);
  });

  test('mobile: stored in E.164 with the chosen country (India when none is sent)', async () => {
    const cases = [
      [undefined, '9000000106', '+919000000106'],
      ['IN', '9000000107', '+919000000107'],
      ['AE', '501234567', '+971501234567'],
      ['QA', '55123456', '+97455123456'],
    ];
    for (const [mobileCountry, mobile, e164] of cases) {
      const r = await submit(sampleV3({ mobile, ...(mobileCountry ? { mobileCountry } : {}) }));
      assert.equal(r.status, 201, `${mobileCountry} ${mobile} ${JSON.stringify(r.body)}`);
      assert.equal((await Registration.findOne({ regNo: r.body.regNo })).mobile, e164);
    }
  });

  test('email format is validated', async () => {
    for (const email of ['plain', 'a@b', 'a@@b.com', 'a b@c.com', '@example.com']) {
      assert.equal((await submit(sampleV3({ email, mobile: '9000000109' }))).status, 400, email);
    }
  });

  test('district must come from the list', async () => {
    const r = await submit(sampleV3({ district: 'Atlantis' }));
    assert.equal(r.status, 400);
    assert.match(r.body.fields.district, /from the list/);
    const ok = await submit(sampleV3({ district: '  east DISTRICT ', mobile: '9000000110' }));
    assert.equal(ok.status, 201);
    assert.equal((await Registration.findOne({ regNo: ok.body.regNo })).district, 'East District');
  });

  test('public config lists the districts', async () => {
    const c = (await request(app).get('/api/public/config')).body;
    assert.deepEqual(c.districts, ['North District', 'East District', 'West District', 'South District']);
  });

  test('rejects unknown fields and filled honeypot', async () => {
    const status = await submit(sampleV3({ status: 'confirmed' }));
    assert.equal(status.status, 400);
    assert.equal(status.body.fields._, 'Unexpected field');
    assert.equal((await submit(sampleV3({ website: 'spam' }))).status, 400);
  });

  test('closed registration is refused', async () => {
    env.registrationOpen = false;
    try {
      assert.equal((await submit(sampleV3({ mobile: '9000000001' }))).status, 403);
    } finally {
      env.registrationOpen = true;
    }
  });

  test('an invalid Idempotency-Key is refused', async () => {
    const r = await submit(sampleV3({ mobile: '9000000111' }), 'short');
    assert.equal(r.status, 400);
    assert.equal(await Registration.countDocuments({ mobile: '+919000000111' }), 0);
  });
});

describe('submission', () => {
  let first;

  test('confirms at once and returns the entry pass; nothing internal is exposed', async () => {
    first = await submit(sampleV3(), 'key-aaaaaaaaaaaaaaaa');
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(Object.keys(first.body).sort(), ['message', 'name', 'ok', 'pass', 'regNo']);
    assert.equal(first.body.ok, true);
    assert.match(first.body.regNo, /^REG-\d{5}$/);
    assert.equal(first.body.name, 'Asha Menon');
    assert.deepEqual(Object.keys(first.body.pass).sort(), ['downloadUrl', 'imageUrl', 'passId']);
    assert.match(first.body.pass.passId, PASS_ID);
    assert.match(first.body.pass.imageUrl, CDN_PASS_URL);
    assert.match(first.body.pass.downloadUrl, new RegExp(`^/api/passes/${first.body.pass.passId}/image\\?v=1&exp=\\d+&sig=[\\w-]+&download=1$`));

    const reg = await Registration.findOne({ regNo: first.body.regNo });
    assert.equal(reg.status, 'confirmed');
    assert.equal(reg.passStatus, 'generated');
    assert.equal(reg.passId, first.body.pass.passId);
    assert.ok(reg.passGeneratedAt);
    assert.ok(reg.confirmedAt);
    assert.equal(reg.confirmedByName, 'system');
    assert.equal(reg.mobile, '+919876543210');
    assert.equal(reg.whatsapp, '+919876543210');
    assert.equal(reg.email, 'asha@example.com');
    assert.equal(reg.area, 'Central Area');
    assert.equal(reg.formVersion, 3);
    assert.equal(reg.photo, TEST_PHOTO);
    assert.equal(reg.statusHistory.length, 1);
    assert.equal(reg.statusHistory[0].from, null);
    assert.equal(reg.statusHistory[0].to, 'confirmed');
    assert.equal(reg.statusHistory[0].byName, 'system');
    assert.equal(await EntryPass.countDocuments({ registration: reg._id }), 1);
    assert.equal((await EntryPass.findOne({ registration: reg._id })).holder.photo, TEST_PHOTO);
  });

  test('the pass PNG is stored in Spaces under TEST/passes/ and the CDN URL points at it', async () => {
    const pass = await EntryPass.findOne({ passId: first.body.pass.passId });
    assert.match(pass.imageKey, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-v1-[a-f0-9]{32}\.png$/);
    assert.equal(first.body.pass.imageUrl, `https://cdn.test.example/TEST/passes/${pass.imageKey}`);

    const stored = spaces.objects.get(`TEST/passes/${pass.imageKey}`);
    assert.ok(stored, 'object exists in the fake bucket');
    assert.ok(spaces.keys('passes/').includes(`passes/${pass.imageKey}`));
    assert.equal(stored.contentType, 'image/png');
    assert.equal(stored.acl, 'public-read');
    assert.deepEqual(stored.body.subarray(0, 8), PNG_SIGNATURE);
    assert.ok(stored.body.length > 10000);
    assert.deepEqual(pngSize(stored.body), { width: 1080, height: 1440 });
  });

  test('downloadUrl serves the stored PNG as an attachment', async () => {
    const res = await request(app).get(first.body.pass.downloadUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(res.headers['content-disposition'], `attachment; filename="entry-pass-${first.body.pass.passId}.png"`);
    assert.deepEqual(res.body.subarray(0, 8), PNG_SIGNATURE);
    const pass = await EntryPass.findOne({ passId: first.body.pass.passId });
    assert.ok(res.body.equals(spaces.objects.get(`TEST/passes/${pass.imageKey}`).body), 'same bytes as the file in Spaces');
  });

  test('same idempotency key returns the original without saving or storing anything again', async () => {
    const count = await Registration.countDocuments();
    const passes = await EntryPass.countDocuments();
    const stored = spaces.keys('passes/').length;
    const res = await submit(sampleV3(), 'key-aaaaaaaaaaaaaaaa');
    assert.equal(res.status, 200);
    assert.equal(res.body.regNo, first.body.regNo);
    assert.equal(res.body.pass.passId, first.body.pass.passId);
    assert.equal(res.body.pass.imageUrl, first.body.pass.imageUrl);
    assert.equal(await Registration.countDocuments(), count);
    assert.equal(await EntryPass.countDocuments(), passes);
    assert.equal(spaces.keys('passes/').length, stored);
  });

  test('same name + mobile is refused as a duplicate and creates no pass', async () => {
    const passes = await EntryPass.countDocuments();
    const res = await submit(sampleV3({ name: '  asha   MENON ', mobile: '9876543210' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'duplicate');
    assert.equal(await EntryPass.countDocuments(), passes);
  });
});

describe('authentication', () => {
  test('admin API requires a session', async () => {
    assert.equal((await request(app).get('/api/admin/registrations')).status, 401);
    assert.equal((await request(app).get('/api/admin/stats')).status, 401);
    assert.equal((await request(app).get('/api/admin/filters')).status, 401);
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
    const r = await admin.post(`/api/admin/registrations/${id}/pass/generate`).send({});
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

describe('entry pass', () => {
  let id;
  let body;

  before(async () => {
    const res = await submit(sampleV3({ name: 'Ravi Kumar', mobile: '9123456780', district: 'East District' }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    body = res.body;
    id = String((await Registration.findOne({ regNo: body.regNo }))._id);
  });

  test('signed image link serves the PNG inline; tampered or expired links do not', async () => {
    const inlineUrl = body.pass.downloadUrl.replace('&download=1', '');
    const ok = await request(app).get(inlineUrl);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'image/png');
    assert.equal(ok.headers['cache-control'], 'private, no-store');
    assert.equal(ok.headers['x-robots-tag'], 'noindex');
    assert.match(ok.headers['content-disposition'], new RegExp(`^inline; filename="entry-pass-${body.pass.passId}\\.png"$`));
    assert.ok(ok.body.length > 10000);

    const path = body.pass.downloadUrl;
    const forged = path.replace(/sig=[^&]+/, 'sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert.equal((await request(app).get(forged)).status, 404);
    const expired = path.replace(/exp=\d+/, 'exp=1000');
    assert.equal((await request(app).get(expired)).status, 404);
    const otherVersion = path.replace('v=1', 'v=2');
    assert.equal((await request(app).get(otherVersion)).status, 404);
    assert.equal((await request(app).get(`/api/passes/${body.pass.passId}/image`)).status, 404);
    assert.equal((await request(app).get(`/api/passes/${body.pass.passId}/image?download=1`)).status, 404);
  });

  test('a cancelled pass no longer downloads', async () => {
    await EntryPass.updateOne({ passId: body.pass.passId }, { $set: { status: 'revoked' } });
    try {
      assert.equal((await request(app).get(body.pass.downloadUrl)).status, 404);
    } finally {
      await EntryPass.updateOne({ passId: body.pass.passId }, { $set: { status: 'active' } });
    }
    assert.equal((await request(app).get(body.pass.downloadUrl)).status, 200);
  });

  test('admin detail: the registration with hasPass, the pass, and permissions', async () => {
    const res = await admin.get(`/api/admin/registrations/${id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['pass', 'permissions', 'registration']);
    assert.deepEqual(res.body.permissions, { send: true, gate: true });
    const r = res.body.registration;
    assert.equal(r.status, 'confirmed');
    assert.equal(r.hasPass, true);
    assert.equal(r.passId, body.pass.passId);
    assert.deepEqual(r.children, []);
    assert.equal(r.statusHistory.length, 1);
    for (const gone of ['passStatus', 'passSentAt', 'confirmedAt', 'messagesTo']) assert.equal(r[gone], undefined, gone);

    assert.equal(res.body.pass.passId, body.pass.passId);
    assert.equal(res.body.pass.status, 'active');
    assert.equal(res.body.pass.imageUrl, `/api/admin/registrations/${id}/pass.png?v=1`);
    assert.equal(res.body.pass.downloadUrl, `/api/admin/registrations/${id}/pass.png?v=1&download=1`);

    assert.equal((await admin.get('/api/admin/registrations/not-an-id')).status, 400);
    assert.equal((await admin.get(`/api/admin/registrations/${new mongoose.Types.ObjectId()}`)).status, 404);
  });

  test('admin pass.png redirects to the CDN image; ?download=1 streams the PNG from Spaces', async () => {
    const pass = await EntryPass.findOne({ registration: id });
    const view = await admin.get(`/api/admin/registrations/${id}/pass.png`);
    assert.equal(view.status, 302);
    assert.equal(view.headers.location, `https://cdn.test.example/TEST/passes/${pass.imageKey}`);
    assert.equal(view.headers.location, body.pass.imageUrl);
    assert.equal(view.headers['cache-control'], 'private, no-store');

    const dl = await admin.get(`/api/admin/registrations/${id}/pass.png?download=1`);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers['content-type'], 'image/png');
    assert.equal(dl.headers['content-disposition'], `attachment; filename="entry-pass-${pass.passId}.png"`);
    assert.deepEqual(dl.body.subarray(0, 8), PNG_SIGNATURE);
    assert.ok(dl.body.equals(spaces.objects.get(`TEST/passes/${pass.imageKey}`).body));

    assert.equal((await request(app).get(`/api/admin/registrations/${id}/pass.png`)).status, 401);
    assert.equal((await request(app).get(`/api/admin/registrations/${id}/pass.png?download=1`)).status, 401);
  });

  test('admin pass.png is 404 for a registration without a pass', async () => {
    const { insertedId } = await Registration.collection.insertOne(
      legacyRegistration({ regNo: 'REG-09100', name: 'No Pass Yet', nameKey: 'no pass yet', mobile: '+919847000100' })
    );
    assert.equal((await admin.get(`/api/admin/registrations/${insertedId}/pass.png`)).status, 404);
    assert.equal((await admin.get(`/api/admin/registrations/${insertedId}/pass.png?download=1`)).status, 404);
    await Registration.deleteOne({ _id: insertedId });
  });

  test('generate on a registration that already has a pass changes nothing', async () => {
    const stored = spaces.keys('passes/').length;
    const res = await admin.post(`/api/admin/registrations/${id}/pass/generate`).set(H);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.pass.passId, body.pass.passId);
    assert.equal(res.body.registration.hasPass, true);
    assert.equal(await EntryPass.countDocuments({ registration: id }), 1);
    assert.equal(spaces.keys('passes/').length, stored);
  });

  test('QR verification accepts the signed code and rejects forgeries', async () => {
    const pass = await EntryPass.findOne({ registration: id });
    const code = qrPayload(pass.passId, pass.version);
    assert.deepEqual(parseQrPayload(code), { passId: pass.passId, version: 1, signed: true });

    const good = await admin.post('/api/admin/passes/verify').set(H).send({ code });
    assert.equal(good.body.valid, true);
    assert.equal(good.body.signed, true);
    assert.equal(good.body.registration.name, 'Ravi Kumar');
    assert.equal(good.body.registration.hasPass, true);
    assert.equal(good.body.pass.passId, pass.passId);

    // A typed pass ID is accepted too, but is not signed.
    const typed = await admin.post('/api/admin/passes/verify').set(H).send({ code: pass.passId });
    assert.equal(typed.body.valid, true);
    assert.equal(typed.body.signed, false);

    const forged = `${pass.passId}.1.${'x'.repeat(32)}`;
    assert.equal((await admin.post('/api/admin/passes/verify').set(H).send({ code: forged })).body.reason, 'invalid_code');
    assert.equal((await admin.post('/api/admin/passes/verify').set(H).send({ code: 'AAAA-AAAA-AAAA' })).body.reason, 'not_found');
    assert.equal((await admin.post('/api/admin/passes/verify').set(H).send({ code: qrPayload(pass.passId, 2) })).body.reason, 'outdated');
    assert.equal((await request(app).post('/api/admin/passes/verify').set(H).send({ code })).status, 401);
  });

  test('a cancelled pass fails verification', async () => {
    const pass = await EntryPass.findOne({ registration: id });
    await EntryPass.updateOne({ _id: pass._id }, { $set: { status: 'revoked' } });
    try {
      const res = await admin.post('/api/admin/passes/verify').set(H).send({ code: qrPayload(pass.passId, pass.version) });
      assert.equal(res.body.valid, false);
      assert.equal(res.body.reason, 'revoked');
    } finally {
      await EntryPass.updateOne({ _id: pass._id }, { $set: { status: 'active' } });
    }
  });
});

describe('when the pass cannot be created', () => {
  test('503 pass_failed keeps the registration; the same Idempotency-Key retries the pass', async (t) => {
    t.mock.method(console, 'error', () => {});
    const key = 'retry-key-aaaaaaaaaa';
    const count = await Registration.countDocuments();
    const stored = spaces.keys('passes/').length;

    spaces.failPuts = true;
    let failed;
    try {
      failed = await submit(sampleV3({ name: 'Retry Person', mobile: '9700000001' }), key);
    } finally {
      spaces.failPuts = false;
    }
    assert.equal(failed.status, 503, JSON.stringify(failed.body));
    assert.equal(failed.body.code, 'pass_failed');
    // The registrant is told the registration is saved and what to do.
    assert.match(failed.body.error, /^Your registration REG-\d{5} is saved, .*press Submit again/);
    assert.equal(failed.body.pass, undefined);

    // The registration is kept and confirmed; its pass has no image yet.
    assert.equal(await Registration.countDocuments(), count + 1);
    const reg = await Registration.findOne({ submissionKey: key });
    assert.equal(reg.status, 'confirmed');
    assert.equal(reg.passStatus, 'not_generated');
    const pass = await EntryPass.findOne({ registration: reg._id });
    assert.ok(pass, 'pass record exists');
    assert.equal(pass.imageKey, '');
    assert.equal(spaces.keys('passes/').length, stored, 'nothing stored in Spaces');
    const missing = (await admin.get('/api/admin/registrations').query({ pass: 'missing', search: 'Retry Person' })).body;
    assert.deepEqual(missing.items.map((i) => [i.name, i.hasPass]), [['Retry Person', false]]);

    // Pressing Submit again with the same key returns that registration with its pass.
    const retry = await submit(sampleV3({ name: 'Retry Person', mobile: '9700000001' }), key);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.regNo, reg.regNo);
    assert.equal(retry.body.pass.passId, pass.passId);
    assert.match(retry.body.pass.imageUrl, CDN_PASS_URL);
    assert.equal(await Registration.countDocuments(), count + 1, 'no second registration');
    assert.equal(await EntryPass.countDocuments({ registration: reg._id }), 1, 'no second pass');

    const saved = await EntryPass.findOne({ registration: reg._id });
    assert.equal(retry.body.pass.imageUrl, `https://cdn.test.example/TEST/passes/${saved.imageKey}`);
    assert.ok(spaces.objects.has(`TEST/passes/${saved.imageKey}`));
    assert.equal((await Registration.findById(reg._id)).passStatus, 'generated');
    assert.equal((await request(app).get(retry.body.pass.downloadUrl)).status, 200);
    const issued = (await admin.get('/api/admin/registrations').query({ pass: 'issued', search: 'Retry Person' })).body;
    assert.deepEqual(issued.items.map((i) => [i.name, i.hasPass]), [['Retry Person', true]]);
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
    // With accompanying children, for the stats.
    await submitAndGetId({
      name: 'Dev Pillai',
      mobile: '9500000004',
      district: 'South District',
      area: 'Lake Area',
      unit: 'Unit 3',
      childrenCount: 2,
      children: [{ name: 'Kiran Pillai', age: 4 }, { name: 'Maya Pillai', age: 8 }],
    });
    // Registered before passes were generated automatically: no pass yet.
    await Registration.collection.insertOne(
      legacyRegistration({ regNo: 'REG-09200', name: 'Waiting Person', nameKey: 'waiting person', mobile: '+919847000200', district: 'East District', area: 'Old Area', unit: 'Old Unit' })
    );
  });

  const list = (q) => admin.get('/api/admin/registrations').query(q);

  test('items carry hasPass and none of the old status or message fields', async () => {
    const items = (await list({ limit: 100 })).body.items;
    const dev = items.find((i) => i.name === 'Dev Pillai');
    assert.equal(dev.hasPass, true);
    assert.equal(dev.status, 'confirmed');
    assert.equal(dev.childrenCount, 2);
    assert.equal(dev.children, undefined, 'children are only in the detail view');
    assert.equal(dev.photoUrl, `https://cdn.test.example/TEST/photos/${TEST_PHOTO}`, 'registrations from the current form show their photo');
    const waiting = items.find((i) => i.name === 'Waiting Person');
    assert.equal(waiting.hasPass, false);
    assert.equal(waiting.status, 'submitted');
    assert.equal(waiting.photoUrl, null, 'older registrations have none');
    for (const item of items) {
      assert.equal(typeof item.hasPass, 'boolean');
      for (const gone of ['passStatus', 'passSentAt', 'confirmedAt', 'messagesTo']) assert.equal(item[gone], undefined, gone);
    }
  });

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

  test('filters by district, area, unit, pass and date', async () => {
    assert.equal((await list({ district: 'west district' })).body.total, 2);
    assert.equal((await list({ district: 'West District', area: 'Hill Area' })).body.total, 1);
    assert.equal((await list({ unit: 'Unit 1' })).body.total, 2);

    const missing = (await list({ pass: 'missing', limit: 100 })).body;
    assert.deepEqual(missing.items.map((i) => i.name), ['Waiting Person']);
    assert.equal(missing.total, 1);
    const issued = (await list({ pass: 'issued', limit: 100 })).body;
    assert.ok(issued.total > 1 && issued.items.every((i) => i.hasPass));
    assert.equal(issued.total + missing.total, (await list({ limit: 100 })).body.total);
    assert.equal((await list({ pass: 'issued', district: 'West District' })).body.total, 2);
    assert.equal((await list({ pass: 'missing', district: 'West District' })).body.total, 0);

    const future = new Date(Date.now() + 86400000).toISOString();
    assert.equal((await list({ from: future })).body.total, 0);
    assert.equal((await list({ from: 'not-a-date' })).status, 400);
  });

  test('the old status and pass-status filters are gone', async () => {
    assert.equal((await list({ pass: 'sent' })).status, 400);
    assert.equal((await list({ pass: 'not_generated' })).status, 400);
    assert.equal((await list({ sort: 'status' })).status, 400);
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

  test('sorts by name, age and district; status is not a sort', async () => {
    const names = (await list({ sort: 'name', dir: 'asc', limit: 100 })).body.items.map((i) => i.name.toLowerCase());
    assert.deepEqual(names, [...names].sort());
    const ages = (await list({ sort: 'age', dir: 'desc', limit: 100 })).body.items.map((i) => i.age);
    assert.deepEqual(ages, [...ages].sort((a, b) => b - a));
    const d = (await list({ sort: 'district', dir: 'asc', limit: 100 })).body.items.map((i) => i.district);
    assert.deepEqual(d, [...d].sort());
    const created = (await list({ sort: 'createdAt', dir: 'asc', limit: 100 })).body.items.map((i) => +new Date(i.createdAt));
    assert.deepEqual(created, [...created].sort((a, b) => a - b));
  });

  test('paginates', async () => {
    const p1 = (await list({ limit: 2, page: 1 })).body;
    const p2 = (await list({ limit: 2, page: 2 })).body;
    assert.equal(p1.items.length, 2);
    assert.equal(p1.pages, Math.ceil(p1.total / 2));
    assert.notEqual(p1.items[0].id, p2.items[0].id);
    assert.equal((await list({ limit: 1000 })).status, 400);
  });

  test('filter options', async () => {
    const f = (await admin.get('/api/admin/filters').query({ district: 'West District' })).body;
    assert.deepEqual(Object.keys(f).sort(), ['areas', 'districts', 'units']);
    assert.deepEqual(f.districts, ['North District', 'East District', 'West District', 'South District']);
    assert.deepEqual(f.areas.sort(), ['Hill Area', 'River Area']);
    assert.deepEqual(f.units.sort(), ['Unit 1', 'Unit 2']);
  });

  test('stats: total, passes issued, without a pass, and children', async () => {
    const s = (await admin.get('/api/admin/stats')).body;
    assert.deepEqual(Object.keys(s).sort(), ['children', 'passesIssued', 'total', 'withoutPass']);
    assert.equal(s.total, await Registration.countDocuments());
    assert.equal(s.withoutPass, await Registration.countDocuments({ passStatus: 'not_generated' }));
    assert.equal(s.passesIssued, await Registration.countDocuments({ passStatus: { $ne: 'not_generated' } }));
    assert.equal(s.withoutPass, 1);
    assert.equal(s.passesIssued + s.withoutPass, s.total);
    const all = await Registration.find().lean();
    assert.equal(s.children, all.reduce((n, r) => n + (r.children ? r.children.length : 0), 0));
    assert.equal(s.children, 2);
  });
});
