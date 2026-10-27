// Records saved before registrations were confirmed and given a pass
// automatically (status "submitted", no pass; or confirmed with a pass whose
// image was never stored in Spaces; no formVersion, gender, place, WhatsApp
// number, children or photo) must keep working: listing, filters, detail, the pass
// image, the gate check and generating the missing pass.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { start, stop, login, spaces, pngSize, legacyRegistration, LEGACY_DATE: now, request } = require('./helpers');
const { Admin, Registration, EntryPass } = require('../src/models');
const { qrPayload, imageLinkQuery } = require('../src/utils/passTokens');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let submittedId;
let confirmedId;
let oldPassId;

// An old confirmed registration whose pass was sent over WhatsApp.
const sentRegistration = (over) =>
  legacyRegistration({
    regNo: 'REG-09002',
    name: 'Old Confirmed',
    nameKey: 'old confirmed',
    mobile: '+919847000002',
    status: 'confirmed',
    confirmedAt: now,
    confirmedByName: 'someone',
    passId: 'K7QM-X2PA-9TZD',
    passStatus: 'sent',
    passGeneratedAt: now,
    passSentAt: now,
    statusHistory: [
      { from: null, to: 'submitted', by: null, byName: 'system', note: 'Submitted online', at: now },
      { from: 'submitted', to: 'confirmed', by: null, byName: 'someone', note: '', at: now },
    ],
    ...over,
  });

before(async () => {
  app = await start();
  admin = await login(app);

  submittedId = (await Registration.collection.insertOne(legacyRegistration())).insertedId;
  confirmedId = (await Registration.collection.insertOne(sentRegistration())).insertedId;
  // Its pass, as the original code wrote it: no stored image, no event details.
  await EntryPass.collection.insertOne({
    passId: 'K7QM-X2PA-9TZD',
    registration: confirmedId,
    version: 1,
    status: 'active',
    holder: { name: 'Old Confirmed', regNo: 'REG-09002', district: 'North District', area: 'Old Area', unit: 'Old Unit' },
    issuedAt: now,
    issuedBy: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  oldPassId = 'K7QM-X2PA-9TZD';
});

after(stop);

describe('reading old records', () => {
  test('missing fields read as "not recorded", not as empty or 0', async () => {
    const r = await Registration.findById(submittedId);
    assert.equal(r.children, undefined);
    assert.equal(r.place, undefined);
    assert.equal(r.whatsapp, undefined);
    assert.equal(r.photo, undefined);

    const res = (await admin.get(`/api/admin/registrations/${submittedId}`)).body;
    const d = res.registration;
    assert.equal(d.formVersion, 1);
    assert.equal(d.gender, null);
    assert.equal(d.place, null);
    assert.equal(d.whatsapp, null);
    assert.equal(d.childrenCount, null);
    assert.equal(d.children, null);
    assert.equal(d.photoUrl, null);
    assert.equal(d.area, 'Old Area');
    assert.equal(d.unit, 'Old Unit');
    assert.equal(d.mobileDisplay, '+91 98470 00001');
    assert.equal(res.pass, null);
    for (const gone of ['passStatus', 'passSentAt', 'confirmedAt', 'messagesTo', 'childAges']) assert.equal(d[gone], undefined, gone);
  });

  test('hasPass: false until the pass exists; a pass sent over WhatsApp counts as issued', async () => {
    // A third record whose WhatsApp send had failed: the pass was still made.
    await Registration.collection.insertOne(
      sentRegistration({ regNo: 'REG-09003', name: 'Old Failed', nameKey: 'old failed', mobile: '+919847000003', passId: 'M3NP-Q4RS-T5VW', passStatus: 'send_failed', passSentAt: null })
    );
    const items = (await admin.get('/api/admin/registrations').query({ limit: 100 })).body.items;
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    assert.equal(byName['Old Submitted'].hasPass, false);
    assert.equal(byName['Old Confirmed'].hasPass, true);
    assert.equal(byName['Old Failed'].hasPass, true);
    for (const item of items) assert.equal(item.photoUrl, null, item.name);

    const issued = (await admin.get('/api/admin/registrations').query({ pass: 'issued' })).body.items.map((i) => i.name).sort();
    assert.deepEqual(issued, ['Old Confirmed', 'Old Failed']);
    const missing = (await admin.get('/api/admin/registrations').query({ pass: 'missing' })).body.items.map((i) => i.name);
    assert.deepEqual(missing, ['Old Submitted']);

    const stats = (await admin.get('/api/admin/stats')).body;
    assert.deepEqual(stats, { total: 3, passesIssued: 2, withoutPass: 1, children: 0 });
  });

  test('listing, search and the District / Area / Unit filters are unchanged', async () => {
    const list = (q) => admin.get('/api/admin/registrations').query(q);
    assert.equal((await list({ area: 'old area' })).body.total, 3);
    assert.equal((await list({ district: 'North District', area: 'Old Area', unit: 'Old Unit' })).body.total, 3);
    assert.equal((await list({ search: '9847000002' })).body.items[0].name, 'Old Confirmed');
    const f = (await admin.get('/api/admin/filters')).body;
    assert.deepEqual(f.areas, ['Old Area']);
    assert.deepEqual(f.units, ['Old Unit']);
  });

  test('reading never writes: the stored documents are unchanged', async () => {
    const raw = await Registration.collection.findOne({ _id: submittedId });
    assert.deepEqual(Object.keys(raw).sort(), Object.keys(legacyRegistration()).concat('_id').sort());
  });
});

describe('old pass', () => {
  test('viewing stores the image in Spaces once and redirects to the CDN; the size is the original', async () => {
    assert.deepEqual(spaces.keys('passes/'), [], 'nothing stored yet');
    const view = await admin.get(`/api/admin/registrations/${confirmedId}/pass.png`);
    assert.equal(view.status, 302);

    const pass = await EntryPass.findOne({ registration: confirmedId });
    assert.match(pass.imageKey, /^K7QM-X2PA-9TZD-v1-[a-f0-9]{32}\.png$/);
    assert.equal(view.headers.location, `https://cdn.test.example/TEST/passes/${pass.imageKey}`);
    const stored = spaces.objects.get(`TEST/passes/${pass.imageKey}`);
    assert.deepEqual(stored.body.subarray(0, 8), PNG_SIGNATURE);
    assert.deepEqual(pngSize(stored.body), { width: 1080, height: 1660 });

    // A second view and a download reuse that file.
    const again = await admin.get(`/api/admin/registrations/${confirmedId}/pass.png`);
    assert.equal(again.headers.location, view.headers.location);
    const dl = await admin.get(`/api/admin/registrations/${confirmedId}/pass.png?download=1`);
    assert.equal(dl.status, 200);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="entry-pass-K7QM-X2PA-9TZD\.png"$/);
    assert.ok(dl.body.equals(stored.body));
    assert.equal(spaces.keys('passes/').length, 1);
  });

  test('a signed download link works for it too', async () => {
    const q = imageLinkQuery(oldPassId, 1);
    const res = await request(app).get(`/api/passes/${oldPassId}/image?v=${q.v}&exp=${q.exp}&sig=${q.sig}&download=1`);
    assert.equal(res.status, 200);
    assert.deepEqual(pngSize(res.body), { width: 1080, height: 1660 });
  });

  test('passes the gate check, with no children or photo on it', async () => {
    const v = await admin.post('/api/admin/passes/verify').set(H).send({ code: qrPayload(oldPassId, 1) });
    assert.equal(v.body.valid, true);
    assert.equal(v.body.registration.name, 'Old Confirmed');
    assert.equal(v.body.registration.hasPass, true);
    assert.equal(v.body.pass.holder.childrenCount, undefined);
    assert.equal(v.body.pass.holder.photo, undefined);
    assert.equal((await admin.post('/api/admin/passes/verify').set(H).send({ code: oldPassId })).body.valid, true);
  });
});

describe('generating the pass of an old submitted record', () => {
  test('confirms it and creates the pass: no place, children or photo on it', async () => {
    const res = await admin.post(`/api/admin/registrations/${submittedId}/pass/generate`).set(H);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.registration.status, 'confirmed');
    assert.equal(res.body.registration.hasPass, true);
    assert.match(res.body.pass.passId, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    assert.equal(res.body.registration.passId, res.body.pass.passId);
    assert.equal(res.body.registration.photoUrl, null);
    assert.equal(res.body.permissions.send, true);
    assert.deepEqual(res.body.registration.statusHistory.map((h) => [h.from, h.to, h.byName]), [
      [null, 'submitted', 'system'],
      ['submitted', 'confirmed', 'chief'],
    ]);

    const pass = await EntryPass.findOne({ registration: submittedId }).lean();
    assert.deepEqual(Object.keys(pass.holder).sort(), ['area', 'district', 'name', 'regNo', 'unit']);
    assert.equal(pass.eventSnapshot.name, 'Test Conference');
    assert.equal(String(pass.issuedBy), String((await Admin.findOne({ username: 'chief' }))._id), 'issued by the admin who generated it');
    const stored = spaces.objects.get(`TEST/passes/${pass.imageKey}`);
    assert.ok(stored, 'image stored in Spaces');
    assert.deepEqual(pngSize(stored.body), { width: 1080, height: 1660 });

    // The update added only workflow fields; the registrant's data is untouched.
    const raw = await Registration.collection.findOne({ _id: submittedId });
    for (const k of ['formVersion', 'gender', 'place', 'whatsapp', 'children', 'photo']) assert.ok(!(k in raw), k);
    assert.equal(raw.status, 'confirmed');
    assert.equal(raw.passStatus, 'generated');
    assert.equal(raw.passId, pass.passId);
    assert.equal(raw.confirmedByName, 'chief');
    assert.ok(raw.confirmedAt);
    assert.ok(raw.passGeneratedAt);
    assert.equal(raw.statusHistory.length, 2);

    // It now counts as issued.
    const missing = (await admin.get('/api/admin/registrations').query({ pass: 'missing' })).body;
    assert.equal(missing.total, 0);
    assert.deepEqual((await admin.get('/api/admin/stats')).body, { total: 3, passesIssued: 3, withoutPass: 0, children: 0 });
  });

  test('generating again returns the same pass and stores nothing new', async () => {
    const before = await EntryPass.findOne({ registration: submittedId });
    const stored = spaces.keys('passes/').length;
    const res = await admin.post(`/api/admin/registrations/${submittedId}/pass/generate`).set(H);
    assert.equal(res.status, 200);
    assert.equal(res.body.pass.passId, before.passId);
    assert.equal(await EntryPass.countDocuments({ registration: submittedId }), 1);
    assert.equal(spaces.keys('passes/').length, stored);
    assert.equal((await Registration.findById(submittedId)).statusHistory.length, 2, 'not confirmed twice');
  });

  test('when Spaces is down: 503 pass_failed; the record is confirmed and generating works once Spaces is back', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { insertedId } = await Registration.collection.insertOne(
      legacyRegistration({ regNo: 'REG-09010', name: 'Old Fourth', nameKey: 'old fourth', mobile: '+919847000010' })
    );

    spaces.failPuts = true;
    let down;
    try {
      down = await admin.post(`/api/admin/registrations/${insertedId}/pass/generate`).set(H);
    } finally {
      spaces.failPuts = false;
    }
    assert.equal(down.status, 503);
    assert.equal(down.body.code, 'pass_failed');
    let reg = await Registration.findById(insertedId);
    assert.equal(reg.status, 'confirmed');
    assert.equal(reg.passStatus, 'not_generated');
    assert.equal((await admin.get(`/api/admin/registrations/${insertedId}`)).body.registration.hasPass, false);

    const up = await admin.post(`/api/admin/registrations/${insertedId}/pass/generate`).set(H);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.registration.hasPass, true);
    assert.equal(await EntryPass.countDocuments({ registration: insertedId }), 1);
    reg = await Registration.findById(insertedId);
    assert.equal(reg.statusHistory.length, 2, 'confirmed only once');
    const pass = await EntryPass.findOne({ registration: insertedId });
    assert.ok(spaces.objects.has(`TEST/passes/${pass.imageKey}`));
  });

  test('needs a session and the CSRF header; unknown and malformed ids are refused', async () => {
    const id = new mongoose.Types.ObjectId();
    assert.equal((await request(app).post(`/api/admin/registrations/${id}/pass/generate`).set(H)).status, 401);
    assert.equal((await admin.post(`/api/admin/registrations/${id}/pass/generate`)).status, 403);
    assert.equal((await admin.post(`/api/admin/registrations/${id}/pass/generate`).set(H)).status, 404);
    assert.equal((await admin.post('/api/admin/registrations/not-an-id/pass/generate').set(H)).status, 400);
  });
});
