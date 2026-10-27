// Registration form version 2: place, WhatsApp number, gender and
// accompanying children, and how they reach messages and entry passes.
// The gender options and child limits used here are test values only; the
// real ones are set by admins once decided.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, login, sample, sampleV2, pngSize, fakeDxing, request } = require('./helpers');
const { Registration, EntryPass, Notification } = require('../src/models');
const { mockOutbox } = require('../src/providers/dxing');
const { EMPTY_PAGE } = require('../src/config/siteSchema');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };

const submit = (body, key) => {
  const r = request(app).post('/api/public/registrations');
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};

async function submitOk(body) {
  const res = await submit(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return Registration.findOne({ regNo: res.body.regNo });
}

async function setRules(form) {
  const s = (await admin.get('/api/admin/website/settings')).body;
  const draft = { ...EMPTY_PAGE, ...s.draft, title: 'Test Conference', form };
  const saved = await admin.put('/api/admin/website/settings').set(H).send({ draft, version: s.version });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const pub = await admin.post('/api/admin/website/settings/publish').set(H).send({ version: saved.body.version });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
}

const NO_RULES = { genderOptions: [], childrenMax: null, childAgeMin: null, childAgeMax: null };
const TEST_RULES = { genderOptions: ['Female', 'Male'], childrenMax: 3, childAgeMin: 0, childAgeMax: 12 };

const confirm = (id) => admin.post(`/api/admin/registrations/${id}/actions/confirm`).set(H).send({});

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  app = await start();
  admin = await login(app);
});

after(stop);

describe('while gender and children rules are not set', () => {
  test('config leaves both questions out', async () => {
    const c = (await request(app).get('/api/public/config')).body;
    assert.equal(c.formVersion, 2);
    assert.deepEqual(c.genderOptions, []);
    assert.equal(c.children, null);
  });

  test('a submission without them is accepted and records nothing for them', async () => {
    const reg = await submitOk(sampleV2({ mobile: '9810000001' }));
    assert.equal(reg.formVersion, 2);
    assert.equal(reg.place, 'Kakkanad');
    assert.equal(reg.gender, undefined);
    assert.equal(reg.children, undefined, 'not asked, so not recorded');
    assert.equal(reg.whatsapp, '+919810000001');
  });

  test('gender or children sent anyway are refused', async () => {
    const g = await submit(sampleV2({ mobile: '9810000002', gender: 'Female' }));
    assert.equal(g.status, 400);
    assert.ok(g.body.fields.gender);
    const c = await submit(sampleV2({ mobile: '9810000002', childrenCount: 2, childAges: [3, 5] }));
    assert.equal(c.status, 400);
    assert.match(c.body.fields.childrenCount, /cannot be added/);
  });
});

describe('fields', () => {
  test('place is required and follows the Area/Unit rule; Area and Unit unchanged', async () => {
    const r = await submit(sampleV2({ place: '', mobile: '9810000003' }));
    assert.equal(r.status, 400);
    assert.match(r.body.fields.place, /required/);
    assert.match((await submit(sampleV2({ place: 'X', mobile: '9810000003' }))).body.fields.place, /at least 2/);
    assert.match((await submit(sampleV2({ place: 'Kochi <script>', mobile: '9810000003' }))).body.fields.place, /not allowed/);
    const ok = await submitOk(sampleV2({ place: '  Fort   Kochi ', mobile: '9810000003' }));
    assert.equal(ok.place, 'Fort Kochi');
    assert.equal(ok.area, 'Central Area');
    assert.equal(ok.unit, 'Unit 4');
  });

  test('WhatsApp: same as phone by default; a different number is validated like the phone number', async () => {
    const missing = await submit(sampleV2({ whatsappSameAsMobile: false, mobile: '9810000004' }));
    assert.match(missing.body.fields.whatsapp, /WhatsApp number/);
    for (const whatsapp of ['98100abcde', '+919810000005', '981000000', '5810000005']) {
      const r = await submit(sampleV2({ whatsappSameAsMobile: false, whatsapp, mobile: '9810000004' }));
      assert.equal(r.status, 400, whatsapp);
      assert.ok(r.body.fields.whatsapp, whatsapp);
      assert.doesNotMatch(r.body.fields.whatsapp, /^Mobile/, whatsapp);
    }
    const conflicting = await submit(sampleV2({ whatsappSameAsMobile: true, whatsapp: '9810000099', mobile: '9810000004' }));
    assert.match(conflicting.body.fields.whatsapp, /Untick/);
    assert.equal((await submit(sampleV2({ whatsappSameAsMobile: 'yes', mobile: '9810000004' }))).status, 400);

    const own = await submitOk(sampleV2({ whatsappSameAsMobile: false, whatsapp: '9810000005', mobile: '9810000004' }));
    assert.equal(own.mobile, '+919810000004');
    assert.equal(own.whatsapp, '+919810000005');
  });

  test('unknown fields, wrong form versions and the honeypot are refused', async () => {
    assert.equal((await submit(sampleV2({ status: 'confirmed' }))).status, 400);
    assert.equal((await submit(sampleV2({ website: 'spam' }))).status, 400);
    const outdated = await submit(sampleV2({ formVersion: 3 }));
    assert.equal(outdated.status, 400);
    assert.equal(outdated.body.code, 'form_outdated');
    // The original form (no formVersion) is still accepted.
    const legacy = await submitOk(sample({ mobile: '9810000006' }));
    assert.equal(legacy.formVersion, undefined);
    assert.equal(legacy.place, undefined);
    assert.equal(legacy.whatsapp, undefined);
  });

  test('duplicate rule unchanged: same name + same phone refused; WhatsApp number is not a duplicate key', async () => {
    await submitOk(sampleV2({ name: 'Dup Person', mobile: '9810000007' }));
    const dup = await submit(sampleV2({ name: 'dup  PERSON', mobile: '9810000007', whatsappSameAsMobile: false, whatsapp: '9810000070' }));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'duplicate');
    // Another person may give the same WhatsApp number (e.g. a family phone).
    await submitOk(sampleV2({ name: 'Other Person', mobile: '9810000008', whatsappSameAsMobile: false, whatsapp: '9810000007' }));
  });

  test('idempotent resubmission still returns the original', async () => {
    const key = 'v2key-aaaaaaaaaaaaaaaa';
    const first = await submit(sampleV2({ name: 'Idem Person', mobile: '9810000009' }), key);
    const second = await submit(sampleV2({ name: 'Idem Person', mobile: '9810000009' }), key);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(first.body.regNo, second.body.regNo);
  });
});

describe('with gender options and children limits set', () => {
  before(() => setRules(TEST_RULES));

  test('config exposes them', async () => {
    const c = (await request(app).get('/api/public/config')).body;
    assert.deepEqual(c.genderOptions, ['Female', 'Male']);
    assert.deepEqual(c.children, { max: 3, ageMin: 0, ageMax: 12 });
  });

  test('gender is required and must be one of the options', async () => {
    assert.match((await submit(sampleV2({ mobile: '9820000001' }))).body.fields.gender, /select/i);
    assert.match((await submit(sampleV2({ mobile: '9820000001', gender: 'Robot' }))).body.fields.gender, /from the list/);
    const ok = await submitOk(sampleV2({ mobile: '9820000001', gender: 'female' }));
    assert.equal(ok.gender, 'Female');
  });

  test('children: count within the limit, one valid age per child', async () => {
    const base = { gender: 'Female', mobile: '9820000002' };
    assert.match((await submit(sampleV2({ ...base, childrenCount: 4, childAges: [1, 2, 3, 4] }))).body.fields.childrenCount, /At most 3/);
    assert.match((await submit(sampleV2({ ...base, childrenCount: 2, childAges: [4] }))).body.fields.childrenCount, /one age/);
    const range = await submit(sampleV2({ ...base, childrenCount: 2, childAges: [4, 13] }));
    assert.match(range.body.fields['childAges.1'], /between 0 and 12/);
    const letters = await submit(sampleV2({ ...base, childrenCount: 1, childAges: ['4y'] }));
    assert.match(letters.body.fields['childAges.0'], /numbers only/);
    assert.match((await submit(sampleV2({ ...base, childrenCount: 1, childAges: [''] }))).body.fields['childAges.0'], /enter the age/);
    assert.equal((await submit(sampleV2({ ...base, childrenCount: -1 }))).status, 400);
    assert.equal((await submit(sampleV2({ ...base, childrenCount: 1.5 }))).status, 400);

    const ok = await submitOk(sampleV2({ ...base, childrenCount: '2', childAges: ['4', 7] }));
    assert.deepEqual(ok.children.map((c) => c.age), [4, 7]);
    const none = await submitOk(sampleV2({ gender: 'Male', mobile: '9820000003', childrenCount: 0 }));
    assert.deepEqual(none.children.toObject(), [], 'asked and answered: 0 children');
  });
});

describe('messages and entry pass', () => {
  let reg;

  before(async () => {
    reg = await submitOk(
      sampleV2({
        name: 'Fathima Rahman',
        gender: 'Female',
        mobile: '9830000001',
        whatsappSameAsMobile: false,
        whatsapp: '9830000002',
        childrenCount: 2,
        childAges: [3, 9],
        place: 'Aluva',
      })
    );
  });

  test('acknowledgement goes to the WhatsApp number', async () => {
    const n = await waitFor(() => Notification.findOne({ registration: reg._id, status: 'accepted' }));
    assert.equal(n.recipient, '+919830000002');
    const sent = mockOutbox.find((m) => m.message.includes(reg.regNo));
    assert.equal(sent.recipient, '919830000002');
  });

  test('confirmation and pass go to the WhatsApp number and state the number of children, never their ages', async () => {
    const before = mockOutbox.length;
    const res = await confirm(reg._id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [text, pass] = mockOutbox.slice(before);
    assert.equal(text.recipient, '919830000002');
    assert.equal(pass.recipient, '919830000002');
    assert.match(text.message, /Accompanying children: 2/);
    assert.match(pass.message, /Accompanying children: 2/);
    assert.match(pass.message, /you and your 2 accompanying children/);
    assert.doesNotMatch(text.message + pass.message, /\b(3|9) (years|yrs)\b|ages?:/i);

    const p = await EntryPass.findOne({ registration: reg._id }).lean();
    assert.equal(p.holder.place, 'Aluva');
    assert.equal(p.holder.childrenCount, 2);
    assert.equal(JSON.stringify(p.holder).includes('age'), false);
    assert.equal(res.body.registration.messagesTo, '+91 98300 00002');
  });

  test('the pass image is taller for the extra rows', async () => {
    const img = await admin.get(`/api/admin/registrations/${reg._id}/pass.png`).buffer(true);
    assert.equal(img.status, 200);
    assert.deepEqual(pngSize(img.body), { width: 1080, height: 1660 + 100 + 110 });
  });

  test('gate check shows the number of children', async () => {
    const p = await EntryPass.findOne({ registration: reg._id });
    const { qrPayload } = require('../src/utils/passTokens');
    const v = await admin.post('/api/admin/passes/verify').set(H).send({ code: qrPayload(p.passId, p.version) });
    assert.equal(v.body.valid, true);
    assert.equal(v.body.pass.holder.childrenCount, 2);
    assert.equal(v.body.registration.childrenCount, 2);
  });

  test('a registration with 0 children gets the one-person pass and no children line', async () => {
    const r = await submitOk(sampleV2({ name: 'Solo Person', gender: 'Female', mobile: '9830000003', childrenCount: 0 }));
    const before = mockOutbox.length;
    await confirm(r._id);
    const [text, pass] = mockOutbox.slice(before);
    assert.equal(text.recipient, '919830000003', 'same as phone number');
    assert.doesNotMatch(text.message + pass.message, /Accompanying children/);
    assert.match(pass.message, /for you only/);
    const img = await admin.get(`/api/admin/registrations/${r._id}/pass.png`).buffer(true);
    assert.deepEqual(pngSize(img.body), { width: 1080, height: 1660 + 100 }, 'place row only');
  });

  test('admin detail shows the new fields', async () => {
    const d = (await admin.get(`/api/admin/registrations/${reg._id}`)).body.registration;
    assert.equal(d.gender, 'Female');
    assert.equal(d.place, 'Aluva');
    assert.equal(d.whatsappDisplay, '+91 98300 00002');
    assert.equal(d.childrenCount, 2);
    assert.deepEqual(d.childAges, [3, 9]);
    assert.equal(d.formVersion, 2);
  });

  test('search covers place and the WhatsApp number', async () => {
    const byPlace = (await admin.get('/api/admin/registrations').query({ search: 'aluva' })).body.items;
    assert.deepEqual(byPlace.map((i) => i.name), ['Fathima Rahman']);
    const byWhatsapp = (await admin.get('/api/admin/registrations').query({ search: '9830000002' })).body.items;
    assert.deepEqual(byWhatsapp.map((i) => i.name), ['Fathima Rahman']);
  });
});

describe('retry after a failure', () => {
  let dx;
  before(async () => {
    dx = await fakeDxing();
    dx.use();
  });
  after(async () => {
    dx.restore();
    await dx.close();
  });

  test('a retried message still goes to the WhatsApp number', async () => {
    dx.state.body = { status: 400, message: 'Invalid account' };
    const reg = await submitOk(sampleV2({ name: 'Retry Person', gender: 'Female', mobile: '9840000001', whatsappSameAsMobile: false, whatsapp: '9840000002' }));
    const failed = await waitFor(() => Notification.findOne({ registration: reg._id, status: 'failed' }));
    assert.equal(dx.received.at(-1).body.recipient, '919840000002');
    dx.state.body = { status: 200, message: 'ok' };
    const r = await admin.post(`/api/admin/registrations/${reg._id}/notifications/${failed._id}/retry`).set(H);
    assert.equal(r.status, 200);
    assert.equal(dx.received.at(-1).body.recipient, '919840000002');
  });
});

describe('turning the rules off again', () => {
  before(() => setRules(NO_RULES));

  test('existing records keep their recorded values', async () => {
    const r = await Registration.findOne({ name: 'Fathima Rahman' });
    assert.equal(r.children.length, 2);
    assert.equal(r.gender, 'Female');
    assert.equal((await submit(sampleV2({ mobile: '9850000001', gender: 'Female' }))).status, 400);
  });
});
