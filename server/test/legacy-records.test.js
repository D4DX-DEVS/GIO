// Records saved before the conference website work (no formVersion, gender,
// place, WhatsApp number or children; passes without place or children) must
// keep working exactly as before: listing, filters, detail, confirm, pass
// image, resend, retry and the gate check.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { start, stop, login, pngSize, request } = require('./helpers');
const { Registration, EntryPass, Notification } = require('../src/models');
const { mockOutbox } = require('../src/providers/dxing');
const { qrPayload } = require('../src/utils/passTokens');
const { buildText } = require('../src/services/templates');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };
const now = new Date('2026-10-20T10:00:00Z');

// Exactly the fields the original code wrote, inserted without Mongoose so
// no new defaults are applied.
function oldRegistration(over) {
  return {
    regNo: 'REG-09001',
    name: 'Old Submitted',
    nameKey: 'old submitted',
    age: 34,
    mobile: '+919847000001',
    email: 'old.one@example.com',
    district: 'North District',
    area: 'Old Area',
    unit: 'Old Unit',
    status: 'submitted',
    statusChangedAt: now,
    statusHistory: [{ from: null, to: 'submitted', by: null, byName: 'system', note: 'Submitted online', at: now }],
    confirmedAt: null,
    confirmedBy: null,
    confirmedByName: '',
    passId: null,
    passStatus: 'not_generated',
    passGeneratedAt: null,
    passSentAt: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
    ...over,
  };
}

let submittedId;
let confirmedId;
let oldPassId;

before(async () => {
  app = await start();
  admin = await login(app);

  submittedId = (await Registration.collection.insertOne(oldRegistration())).insertedId;
  confirmedId = (
    await Registration.collection.insertOne(
      oldRegistration({
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
      })
    )
  ).insertedId;
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

    const d = (await admin.get(`/api/admin/registrations/${submittedId}`)).body.registration;
    assert.equal(d.formVersion, 1);
    assert.equal(d.gender, null);
    assert.equal(d.place, null);
    assert.equal(d.whatsapp, null);
    assert.equal(d.childrenCount, null);
    assert.equal(d.childAges, null);
    assert.equal(d.messagesTo, '+91 98470 00001');
    assert.equal(d.area, 'Old Area');
    assert.equal(d.unit, 'Old Unit');
  });

  test('listing, search and the District / Area / Unit filters are unchanged', async () => {
    const list = (q) => admin.get('/api/admin/registrations').query(q);
    assert.equal((await list({ area: 'old area' })).body.total, 2);
    assert.equal((await list({ district: 'North District', area: 'Old Area', unit: 'Old Unit' })).body.total, 2);
    assert.equal((await list({ search: '9847000002' })).body.items[0].name, 'Old Confirmed');
    const f = (await admin.get('/api/admin/filters')).body;
    assert.deepEqual(f.areas, ['Old Area']);
    assert.deepEqual(f.units, ['Old Unit']);
  });

  test('reading never writes: the stored documents are unchanged', async () => {
    const raw = await Registration.collection.findOne({ _id: submittedId });
    assert.deepEqual(Object.keys(raw).sort(), Object.keys(oldRegistration()).concat('_id').sort());
  });
});

describe('old pass', () => {
  test('renders at the original size and passes the gate check', async () => {
    const img = await admin.get(`/api/admin/registrations/${confirmedId}/pass.png`).buffer(true);
    assert.equal(img.status, 200);
    assert.deepEqual(pngSize(img.body), { width: 1080, height: 1660 });

    const v = await admin.post('/api/admin/passes/verify').set(H).send({ code: qrPayload(oldPassId, 1) });
    assert.equal(v.body.valid, true);
    assert.equal(v.body.registration.name, 'Old Confirmed');
    assert.equal(v.body.pass.holder.childrenCount, undefined);
    assert.equal((await admin.post('/api/admin/passes/verify').set(H).send({ code: oldPassId })).body.valid, true);
  });

  test('resend goes to the mobile number with the original caption', async () => {
    const before = mockOutbox.length;
    const r = await admin.post(`/api/admin/registrations/${confirmedId}/pass/resend`).set(H);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const sent = mockOutbox.slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipient, '919847000002');
    assert.doesNotMatch(sent[0].message, /children/i);
    assert.match(sent[0].message, /This pass is for you only/);
    assert.equal(await EntryPass.countDocuments({ registration: confirmedId }), 1);
  });

  test('the caption and confirmation text are word for word the original wording', () => {
    const event = { name: 'Test Conference', date: '1 Jan 2027', venue: 'Test Hall', supportContact: '' };
    const r = { name: 'Old Confirmed', regNo: 'REG-09002' };
    assert.equal(
      buildText('entry_pass', { registration: r, pass: { passId: oldPassId, holder: {} }, event }),
      [
        '*Entry pass - Test Conference*',
        '',
        'Name: Old Confirmed',
        `Pass ID: *${oldPassId}*`,
        'Registration number: REG-09002',
        'Date: 1 Jan 2027',
        'Venue: Test Hall',
        '',
        'Please show the QR code on this pass at the entrance. This pass is for you only; do not share it.',
      ].join('\n')
    );
    assert.equal(
      buildText('registration_confirmed', { registration: r, event }),
      [
        'Dear Old Confirmed,',
        '',
        'We are pleased to inform you that your registration *REG-09002* for *Test Conference* is *confirmed*.',
        '',
        'Date: 1 Jan 2027',
        'Venue: Test Hall',
        '',
        'Your entry pass will follow in the next message.',
      ].join('\n')
    );
  });
});

describe('confirming an old submitted record', () => {
  test('works as before: mobile number, no place or children on the pass', async () => {
    const before = mockOutbox.length;
    const r = await admin.post(`/api/admin/registrations/${submittedId}/actions/confirm`).set(H).send({});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.registration.status, 'confirmed');
    assert.equal(r.body.registration.passStatus, 'sent');
    const sent = mockOutbox.slice(before);
    assert.equal(sent.length, 2);
    assert.ok(sent.every((m) => m.recipient === '919847000001'));
    assert.doesNotMatch(sent[0].message + sent[1].message, /children/i);

    const pass = await EntryPass.findOne({ registration: submittedId }).lean();
    assert.deepEqual(Object.keys(pass.holder).sort(), ['area', 'district', 'name', 'regNo', 'unit']);
    const img = await admin.get(`/api/admin/registrations/${submittedId}/pass.png`).buffer(true);
    assert.deepEqual(pngSize(img.body), { width: 1080, height: 1660 });

    const n = await Notification.find({ registration: new mongoose.Types.ObjectId(String(submittedId)) });
    assert.ok(n.every((x) => x.recipient === '+919847000001'));

    // The update added only workflow fields; the registrant's data is untouched.
    const raw = await Registration.collection.findOne({ _id: submittedId });
    for (const k of ['formVersion', 'gender', 'place', 'whatsapp', 'children']) assert.ok(!(k in raw), k);
    assert.equal(raw.statusHistory.length, 2);
  });
});
