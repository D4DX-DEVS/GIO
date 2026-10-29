// The registration form (version 3): optional Area and Unit, phone numbers
// per country, WhatsApp, gender and accompanying children with names and
// ages, the registrant's photo (upload, required on the form, printed on the
// pass), how older form versions are treated, and how the new fields reach
// the entry pass and the admin views.
// The gender options and child limits used here are test values only; the
// real ones are set by admins.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('canvas');
const { start, stop, login, sample, sampleV3, TEST_PHOTO, image, jpegWithExif, pngSize, spaces, request, env } = require('./helpers');
const { Registration, EntryPass } = require('../src/models');
const { EMPTY_PAGE } = require('../src/config/siteSchema');
const { qrPayload } = require('../src/utils/passTokens');
const { inspect } = require('../src/services/assets');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };

// Pass image size (src/services/passRenderer.js): the delegate frame's, for every pass.
const PASS_SIZE = { width: 1080, height: 1440 };
const PHOTO_KEY = /^[a-f0-9]{32}\.jpg$/;
const cdnPhoto = (key) => `https://cdn.test.example/TEST/photos/${key}`;

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
const DEFAULT_CHILDREN = { max: 10, ageMin: 0, ageMax: 17 };

const kids = (n, over = {}) => Array.from({ length: n }, () => ({ name: 'Anu Menon', age: 5, ...over }));

before(async () => {
  app = await start();
  admin = await login(app);
});

after(stop);

describe('form version', () => {
  test('config announces version 3 with no gender question and the default children limits', async () => {
    const c = (await request(app).get('/api/public/config')).body;
    assert.equal(c.formVersion, 3);
    assert.equal(c.defaultCountry, 'IN');
    assert.deepEqual(c.genderOptions, []);
    assert.deepEqual(c.children, DEFAULT_CHILDREN);
  });

  test('version 2 is refused so the page is reloaded; so is any other version', async () => {
    for (const formVersion of [2, 4, '3', 0]) {
      const r = await submit(sampleV3({ formVersion, mobile: '9810000001' }));
      assert.equal(r.status, 400, String(formVersion));
      assert.equal(r.body.code, 'form_outdated', String(formVersion));
      assert.match(r.body.error, /out of date/);
    }
    assert.equal(await Registration.countDocuments(), 0);
  });

  test('the original form (no formVersion) is still accepted, with its own fields', async () => {
    const res = await submit(sample({ mobile: '9810000006' }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.pass.imageUrl, 'a pass is issued for these too');
    const legacy = await Registration.findOne({ regNo: res.body.regNo });
    assert.equal(legacy.status, 'confirmed');
    assert.equal(legacy.formVersion, undefined);
    assert.equal(legacy.place, undefined);
    assert.equal(legacy.whatsapp, undefined);
    assert.equal(legacy.children, undefined);
    assert.equal(legacy.area, 'Central Area');
    assert.equal(legacy.unit, 'Unit 4');
  });

  test('the original form has no photo: the registration and its pass carry none', async () => {
    const res = await submit(sample({ name: 'Legacy NoPhoto', mobile: '9810000009' }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const reg = await Registration.findOne({ regNo: res.body.regNo });
    assert.equal(reg.photo, undefined);
    const pass = await EntryPass.findOne({ registration: reg._id });
    assert.equal(pass.holder.photo, undefined);
    assert.equal('photo' in (await EntryPass.findById(pass._id).lean()).holder, false);
    assert.deepEqual(pngSize(spaces.objects.get(`TEST/passes/${pass.imageKey}`).body), PASS_SIZE);
    const detail = (await admin.get(`/api/admin/registrations/${reg._id}`)).body.registration;
    assert.equal(detail.photoUrl, null);
    assert.equal((await admin.get('/api/admin/registrations').query({ search: 'Legacy NoPhoto' })).body.items[0].photoUrl, null);
  });

  test('the original form still requires Area and Unit and reads countryCode as a calling code', async () => {
    const missing = await submit(sample({ area: ' ', unit: '', mobile: '9810000007' }));
    assert.equal(missing.status, 400);
    assert.match(missing.body.fields.area, /required/);
    assert.match(missing.body.fields.unit, /required/);

    for (const countryCode of ['+91', '999', 'IN', 'abc']) {
      const r = await submit(sample({ countryCode, mobile: '9810000007' }));
      assert.equal(r.status, 400, countryCode);
      assert.match(r.body.fields.countryCode, /country code/, countryCode);
    }
    assert.match((await submit(sample({ countryCode: '971', mobile: '5012345678' }))).body.fields.mobile, /9-digit/);
    const uae = await submitOk(sample({ name: 'Uae Legacy', countryCode: '971', mobile: '501234567' }));
    assert.equal(uae.mobile, '+971501234567');
  });

  test('version 3 refuses the original form\'s countryCode field', async () => {
    const r = await submit(sampleV3({ countryCode: '91', mobile: '9810000008' }));
    assert.equal(r.status, 400);
    assert.equal(r.body.fields._, 'Unexpected field');
  });
});

describe('Area, Unit and Place', () => {
  test('Area and Unit are optional: omitted or empty are stored as empty', async () => {
    const { area, unit, ...rest } = sampleV3();
    const omitted = await submitOk({ ...rest, name: 'No Area', mobile: '9810000010' });
    assert.equal(omitted.area, '');
    assert.equal(omitted.unit, '');
    const empty = await submitOk(sampleV3({ name: 'Empty Area', mobile: '9810000011', area: '', unit: '' }));
    assert.equal(empty.area, '');
    assert.equal(empty.unit, '');
    const onlyUnit = await submitOk(sampleV3({ name: 'Only Unit', mobile: '9810000012', area: '', unit: '  Unit   9 ' }));
    assert.equal(onlyUnit.area, '');
    assert.equal(onlyUnit.unit, 'Unit 9');
    const blank = await submitOk(sampleV3({ name: 'Blank Area', mobile: '9810000014', area: '   ', unit: ' ' }));
    assert.equal(blank.area, '');
    assert.equal(blank.unit, '');

    // The pass is issued all the same.
    const pass = await EntryPass.findOne({ registration: omitted._id });
    assert.equal(pass.holder.area, '');
    assert.equal(pass.holder.unit, '');
  });

  test('when Area or Unit is given it is still checked', async () => {
    const r = await submit(sampleV3({ area: 'X', unit: 'Unit <b>', mobile: '9810000013' }));
    assert.equal(r.status, 400);
    assert.match(r.body.fields.area, /at least 2/);
    assert.match(r.body.fields.unit, /not allowed/);
  });

  test('Place is required; Area and Unit keep their meaning', async () => {
    const r = await submit(sampleV3({ place: '', mobile: '9810000003' }));
    assert.equal(r.status, 400);
    assert.match(r.body.fields.place, /required/);
    assert.match((await submit(sampleV3({ place: 'X', mobile: '9810000003' }))).body.fields.place, /at least 2/);
    assert.match((await submit(sampleV3({ place: 'Kochi <script>', mobile: '9810000003' }))).body.fields.place, /not allowed/);
    const ok = await submitOk(sampleV3({ place: '  Fort   Kochi ', mobile: '9810000003' }));
    assert.equal(ok.place, 'Fort Kochi');
    assert.equal(ok.area, 'Central Area');
    assert.equal(ok.unit, 'Unit 4');
  });
});

describe('phone numbers by country', () => {
  test('India: 10 digits starting 6-9; other lengths and symbols are refused', async () => {
    const mobile = (m, over = {}) => submit(sampleV3({ mobile: m, ...over }));
    assert.match((await mobile('987654321')).body.fields.mobile, /Enter a valid 10-digit mobile number/);
    assert.match((await mobile('98765432101')).body.fields.mobile, /Enter a valid 10-digit mobile number/);
    assert.match((await mobile('98765 43210')).body.fields.mobile, /Mobile number can contain digits only/);
    assert.match((await mobile('5876543210')).body.fields.mobile, /Enter a valid mobile number/);
    const ok = await submitOk(sampleV3({ mobile: '9810000020', mobileCountry: 'IN' }));
    assert.equal(ok.mobile, '+919810000020');
  });

  test('UAE: 9 digits; the Indian length is refused', async () => {
    const tenDigits = await submit(sampleV3({ mobileCountry: 'AE', mobile: '5012345678' }));
    assert.equal(tenDigits.status, 400);
    assert.match(tenDigits.body.fields.mobile, /Enter a valid 9-digit mobile number/);
    assert.match((await submit(sampleV3({ mobileCountry: 'AE', mobile: '50123456' }))).body.fields.mobile, /9-digit/);
    const ok = await submitOk(sampleV3({ mobileCountry: 'AE', mobile: '501234567' }));
    assert.equal(ok.mobile, '+971501234567');
    assert.equal(ok.whatsapp, '+971501234567', 'same as the phone number, in the same country');
  });

  test('a country that is not in the list is refused on the country field', async () => {
    for (const mobileCountry of ['XX', '91', '+91', 'India']) {
      const r = await submit(sampleV3({ mobileCountry, mobile: '9810000021' }));
      assert.equal(r.status, 400, mobileCountry);
      assert.equal(r.body.fields.mobileCountry, 'Select a country from the list', mobileCountry);
      assert.equal(r.body.fields.mobile, undefined, mobileCountry);
    }
    const r = await submit(sampleV3({ whatsappSameAsMobile: false, whatsappCountry: 'XX', whatsapp: '9810000022', mobile: '9810000021' }));
    assert.equal(r.body.fields.whatsappCountry, 'Select a country from the list');
  });

  test('WhatsApp can be in another country than the phone number', async () => {
    const reg = await submitOk(
      sampleV3({ mobileCountry: 'IN', mobile: '9810000023', whatsappSameAsMobile: false, whatsappCountry: 'AE', whatsapp: '501234568' })
    );
    assert.equal(reg.mobile, '+919810000023');
    assert.equal(reg.whatsapp, '+971501234568');

    const wrongLength = await submit(
      sampleV3({ mobile: '9810000024', whatsappSameAsMobile: false, whatsappCountry: 'AE', whatsapp: '9810000025' })
    );
    assert.match(wrongLength.body.fields.whatsapp, /Enter a valid 9-digit WhatsApp number/);
  });

  test('WhatsApp: same as phone by default; a different number is validated like the phone number', async () => {
    const missing = await submit(sampleV3({ whatsappSameAsMobile: false, mobile: '9810000004' }));
    assert.match(missing.body.fields.whatsapp, /WhatsApp number/);
    for (const whatsapp of ['98100abcde', '+919810000005', '981000000', '5810000005']) {
      const r = await submit(sampleV3({ whatsappSameAsMobile: false, whatsapp, mobile: '9810000004' }));
      assert.equal(r.status, 400, whatsapp);
      assert.ok(r.body.fields.whatsapp, whatsapp);
      assert.doesNotMatch(r.body.fields.whatsapp, /^Mobile/, whatsapp);
    }
    const conflicting = await submit(sampleV3({ whatsappSameAsMobile: true, whatsapp: '9810000099', mobile: '9810000004' }));
    assert.match(conflicting.body.fields.whatsapp, /Untick/);
    assert.equal((await submit(sampleV3({ whatsappSameAsMobile: 'yes', mobile: '9810000004' }))).status, 400);

    const own = await submitOk(sampleV3({ whatsappSameAsMobile: false, whatsapp: '9810000005', mobile: '9810000004' }));
    assert.equal(own.mobile, '+919810000004');
    assert.equal(own.whatsapp, '+919810000005');
  });
});

describe('submissions', () => {
  test('unknown fields and the honeypot are refused', async () => {
    assert.equal((await submit(sampleV3({ status: 'confirmed' }))).status, 400);
    assert.equal((await submit(sampleV3({ website: 'spam' }))).status, 400);
    assert.equal((await submit(sampleV3({ childAges: [3] }))).status, 400);
  });

  test('duplicate rule: same name + same phone refused; the WhatsApp number is not a duplicate key', async () => {
    await submitOk(sampleV3({ name: 'Dup Person', mobile: '9810000030' }));
    const dup = await submit(sampleV3({ name: 'dup  PERSON', mobile: '9810000030', whatsappSameAsMobile: false, whatsapp: '9810000031' }));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'duplicate');
    // Another person may give the same WhatsApp number (e.g. a family phone).
    await submitOk(sampleV3({ name: 'Other Person', mobile: '9810000032', whatsappSameAsMobile: false, whatsapp: '9810000030' }));
  });

  test('idempotent resubmission returns the original registration and pass', async () => {
    const key = 'v3key-aaaaaaaaaaaaaaaa';
    const first = await submit(sampleV3({ name: 'Idem Person', mobile: '9810000033' }), key);
    const second = await submit(sampleV3({ name: 'Idem Person', mobile: '9810000033' }), key);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(first.body.regNo, second.body.regNo);
    assert.equal(first.body.pass.passId, second.body.pass.passId);
  });
});

describe('accompanying children (default limits, no admin rules yet)', () => {
  const base = { mobile: '9810000040' };

  test('no children: an empty list is stored as 0 children', async () => {
    const reg = await submitOk(sampleV3({ mobile: '9810000041', childrenCount: 0, children: [] }));
    assert.deepEqual(reg.children.toObject(), []);
    // Both may also be left out.
    const { childrenCount, children, ...rest } = sampleV3({ name: 'Left Out', mobile: '9810000042' });
    const omitted = await submitOk(rest);
    assert.deepEqual(omitted.children.toObject(), []);
  });

  test('names and ages are stored for each child', async () => {
    const ok = await submitOk(
      sampleV3({ ...base, name: 'Parent One', mobile: '9810000043', childrenCount: '2', children: [{ name: '  Anu   Menon ', age: '4' }, { name: 'Ravi', age: 7 }] })
    );
    assert.deepEqual(ok.children.map((c) => ({ name: c.name, age: c.age })), [{ name: 'Anu Menon', age: 4 }, { name: 'Ravi', age: 7 }]);
    const admin1 = (await admin.get(`/api/admin/registrations/${ok._id}`)).body.registration;
    assert.deepEqual(admin1.children, [{ name: 'Anu Menon', age: 4 }, { name: 'Ravi', age: 7 }]);
    assert.equal(admin1.childrenCount, 2);
  });

  test('more children than the maximum is refused', async () => {
    const ten = await submitOk(sampleV3({ name: 'Big Family', mobile: '9810000044', childrenCount: 10, children: kids(10) }));
    assert.equal(ten.children.length, 10);
    const eleven = await submit(sampleV3({ mobile: '9810000045', childrenCount: 11, children: kids(11) }));
    assert.equal(eleven.status, 400);
    assert.equal(eleven.body.fields.childrenCount, 'At most 10 accompanying children');
    assert.equal(await Registration.countDocuments({ mobile: '+919810000045' }), 0);
  });

  test('the number must be a whole number and match the children entered', async () => {
    for (const childrenCount of [-1, 1.5, 'two', '1e1']) {
      const r = await submit(sampleV3({ ...base, childrenCount, children: [] }));
      assert.equal(r.status, 400, String(childrenCount));
      assert.ok(r.body.fields.childrenCount, String(childrenCount));
    }
    const fewer = await submit(sampleV3({ ...base, childrenCount: 2, children: kids(1) }));
    assert.match(fewer.body.fields.childrenCount, /name and age for each child/);
    const none = await submit(sampleV3({ ...base, childrenCount: 2 }));
    assert.match(none.body.fields.childrenCount, /name and age for each child/);
    const more = await submit(sampleV3({ ...base, childrenCount: 0, children: kids(1) }));
    assert.match(more.body.fields.childrenCount, /name and age for each child/);
    const notAList = await submit(sampleV3({ ...base, childrenCount: 1, children: 'Anu' }));
    assert.ok(notAList.body.fields.children);
  });

  // Each call uses a new phone number, so a valid child is saved instead of tripping the duplicate rule.
  let seq = 0;
  const withChildren = (children) =>
    submit(sampleV3({ name: 'Child Tester', mobile: `98100600${String(seq++).padStart(2, '0')}`, childrenCount: children.length, children }));
  const nameField = async (name) => (await withChildren([{ name, age: 5 }])).body.fields?.['children.0.name'];
  const ageField = async (age) => (await withChildren([{ name: 'Anu Menon', age }])).body.fields?.['children.0.age'];

  test('each child needs a valid name', async () => {
    assert.equal(await nameField(''), 'Please enter the name');
    assert.equal(await nameField(undefined), 'Please enter the name');
    assert.equal(await nameField(7), 'Please enter the name');
    assert.match(await nameField('R2D2'), /cannot contain numbers/);
    assert.match(await nameField('A'), /at least 2 characters/);
    assert.match(await nameField('Mary-Anne'), /only letters and spaces/);
    assert.equal(await nameField('Anu Menon'), undefined);
  });

  test('each child needs an age within the limits, reported per child', async () => {
    assert.equal(await ageField(''), 'Please enter the age');
    assert.equal(await ageField(undefined), 'Please enter the age');
    assert.match(await ageField('4y'), /numbers only/);
    assert.match(await ageField(1.5), /numbers only/);
    assert.match(await ageField(-1), /numbers only/);
    assert.match(await ageField(18), /between 0 and 17/);
    assert.equal(await ageField(17), undefined);
    assert.equal(await ageField(0), undefined);

    const second = await withChildren([{ name: 'Anu Menon', age: 4 }, { name: '', age: 40 }]);
    assert.equal(second.body.fields['children.0.name'], undefined);
    assert.equal(second.body.fields['children.0.age'], undefined);
    assert.ok(second.body.fields['children.1.name']);
    assert.match(second.body.fields['children.1.age'], /between 0 and 17/);
  });

  test('a child entry may not carry other fields', async () => {
    const r = await submit(sampleV3({ ...base, childrenCount: 1, children: [{ name: 'Anu Menon', age: 4, gender: 'F' }] }));
    assert.equal(r.status, 400);
    assert.equal(r.body.fields['children.0'], 'Unexpected field');
  });
});

describe('gender, with no options set', () => {
  test('gender sent anyway is refused and nothing is recorded for it', async () => {
    const g = await submit(sampleV3({ mobile: '9810000050', gender: 'Female' }));
    assert.equal(g.status, 400);
    assert.ok(g.body.fields.gender);
    const reg = await submitOk(sampleV3({ mobile: '9810000051' }));
    assert.equal(reg.gender, undefined);
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
    assert.match((await submit(sampleV3({ mobile: '9820000001' }))).body.fields.gender, /select/i);
    assert.match((await submit(sampleV3({ mobile: '9820000001', gender: 'Robot' }))).body.fields.gender, /from the list/);
    const ok = await submitOk(sampleV3({ mobile: '9820000001', gender: 'female' }));
    assert.equal(ok.gender, 'Female');
  });

  test('children: the admin-set maximum and age range apply', async () => {
    const base = { gender: 'Female', mobile: '9820000002' };
    const four = await submit(sampleV3({ ...base, childrenCount: 4, children: kids(4) }));
    assert.equal(four.body.fields.childrenCount, 'At most 3 accompanying children');
    const range = await submit(sampleV3({ ...base, childrenCount: 2, children: [{ name: 'Anu Menon', age: 4 }, { name: 'Ravi Menon', age: 13 }] }));
    assert.match(range.body.fields['children.1.age'], /between 0 and 12/);
    assert.equal(range.body.fields['children.0.age'], undefined);

    const ok = await submitOk(sampleV3({ ...base, mobile: '9820000003', childrenCount: 3, children: [{ name: 'Anu Menon', age: 12 }, { name: 'Ravi Menon', age: 0 }, { name: 'Mia', age: 6 }] }));
    assert.deepEqual(ok.children.map((c) => c.age), [12, 0, 6]);
    const none = await submitOk(sampleV3({ gender: 'Male', mobile: '9820000004', childrenCount: 0 }));
    assert.deepEqual(none.children.toObject(), [], 'asked and answered: 0 children');
  });
});

describe('entry pass and admin views of the new fields', () => {
  let reg;

  before(async () => {
    reg = await submitOk(
      sampleV3({
        name: 'Fathima Rahman',
        gender: 'Female',
        mobile: '9830000001',
        whatsappSameAsMobile: false,
        whatsapp: '9830000002',
        childrenCount: 2,
        children: [{ name: 'Zayn Rahman', age: 3 }, { name: 'Mia Rahman', age: 9 }],
        place: 'Aluva',
      })
    );
  });

  test('the pass holds the place and the number of children, never their names or ages', async () => {
    const p = await EntryPass.findOne({ registration: reg._id }).lean();
    assert.equal(p.holder.place, 'Aluva');
    assert.equal(p.holder.childrenCount, 2);
    const holder = JSON.stringify(p.holder);
    assert.equal(holder.includes('age'), false);
    assert.equal(holder.includes('Zayn'), false);
    assert.equal(holder.includes('Mia'), false);
  });

  test('the pass holds the photo key', async () => {
    const p = await EntryPass.findOne({ registration: reg._id }).lean();
    assert.equal(p.holder.photo, TEST_PHOTO);
    assert.equal((await Registration.findById(reg._id)).photo, TEST_PHOTO);
  });

  test('the stored pass image is the size of the delegate frame', async () => {
    const pass = await EntryPass.findOne({ registration: reg._id });
    const stored = spaces.objects.get(`TEST/passes/${pass.imageKey}`).body;
    assert.deepEqual(pngSize(stored), PASS_SIZE);
    const img = await admin.get(`/api/admin/registrations/${reg._id}/pass.png?download=1`).buffer(true);
    assert.equal(img.status, 200);
    assert.deepEqual(pngSize(img.body), PASS_SIZE);
  });

  test('a registration with 0 children gets its pass', async () => {
    const r = await submitOk(sampleV3({ name: 'Solo Person', gender: 'Female', mobile: '9830000003', childrenCount: 0 }));
    const pass = await EntryPass.findOne({ registration: r._id });
    assert.deepEqual(pngSize(spaces.objects.get(`TEST/passes/${pass.imageKey}`).body), PASS_SIZE);
    assert.equal(r.whatsapp, r.mobile, 'same as phone number');
  });

  test('gate check shows the number of children', async () => {
    const p = await EntryPass.findOne({ registration: reg._id });
    const v = await admin.post('/api/admin/passes/verify').set(H).send({ code: qrPayload(p.passId, p.version) });
    assert.equal(v.body.valid, true);
    assert.equal(v.body.pass.holder.childrenCount, 2);
    assert.equal(v.body.registration.childrenCount, 2);
    assert.equal(v.body.registration.children, undefined, 'names and ages are not part of the gate view');
  });

  test('admin detail shows the new fields', async () => {
    const d = (await admin.get(`/api/admin/registrations/${reg._id}`)).body.registration;
    assert.equal(d.gender, 'Female');
    assert.equal(d.place, 'Aluva');
    assert.equal(d.mobileDisplay, '+91 98300 00001');
    assert.equal(d.whatsappDisplay, '+91 98300 00002');
    assert.equal(d.childrenCount, 2);
    assert.deepEqual(d.children, [{ name: 'Zayn Rahman', age: 3 }, { name: 'Mia Rahman', age: 9 }]);
    assert.equal(d.childAges, undefined);
    assert.equal(d.formVersion, 3);
    assert.equal(d.hasPass, true);
  });

  test('admin list and detail carry the photo as a CDN URL', async () => {
    const d = (await admin.get(`/api/admin/registrations/${reg._id}`)).body.registration;
    assert.equal(d.photoUrl, cdnPhoto(TEST_PHOTO));
    const item = (await admin.get('/api/admin/registrations').query({ search: 'Fathima' })).body.items[0];
    assert.equal(item.name, 'Fathima Rahman');
    assert.equal(item.photoUrl, cdnPhoto(TEST_PHOTO));
    assert.equal(item.photo, undefined, 'the stored key is not part of the list item');
  });

  test('search covers place and the WhatsApp number', async () => {
    const byPlace = (await admin.get('/api/admin/registrations').query({ search: 'aluva' })).body.items;
    assert.deepEqual(byPlace.map((i) => i.name), ['Fathima Rahman']);
    const byWhatsapp = (await admin.get('/api/admin/registrations').query({ search: '9830000002' })).body.items;
    assert.deepEqual(byWhatsapp.map((i) => i.name), ['Fathima Rahman']);
  });
});

describe('turning the rules off again', () => {
  before(() => setRules(NO_RULES));

  test('existing records keep their recorded values; the default limits apply again', async () => {
    const r = await Registration.findOne({ name: 'Fathima Rahman' });
    assert.equal(r.children.length, 2);
    assert.equal(r.gender, 'Female');
    assert.equal((await submit(sampleV3({ mobile: '9850000001', gender: 'Female' }))).status, 400);
    assert.deepEqual((await request(app).get('/api/public/config')).body.children, DEFAULT_CHILDREN);
  });
});

// --- Registrant photo --------------------------------------------------------

const uploadPhoto = (body, type = 'image/jpeg') => request(app).post('/api/public/photos').set('Content-Type', type).send(body);
const storedPhoto = (key) => spaces.objects.get(`TEST/photos/${key}`);
const photoKeys = () => spaces.keys('photos/').sort();

describe('photo upload', () => {
  test('a JPEG is stored in Spaces under TEST/photos/ and its CDN URL is returned', async () => {
    const res = await uploadPhoto(image(600, 800, 'jpeg'));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), ['height', 'photo', 'url', 'width']);
    assert.match(res.body.photo, PHOTO_KEY);
    assert.equal(res.body.url, cdnPhoto(res.body.photo));
    assert.deepEqual([res.body.width, res.body.height], [600, 800]);

    const file = storedPhoto(res.body.photo);
    assert.ok(file, 'the bytes are in the fake bucket');
    assert.ok(photoKeys().includes(`photos/${res.body.photo}`));
    assert.equal(file.contentType, 'image/jpeg');
    assert.equal(file.acl, 'public-read');
    assert.match(file.cacheControl, /immutable/);
    assert.equal(inspect(file.body).type, 'jpeg');
    assert.deepEqual([inspect(file.body).width, inspect(file.body).height], [600, 800]);
  });

  test('every upload gets its own key', async () => {
    const a = await uploadPhoto(image(300, 300, 'jpeg'));
    const b = await uploadPhoto(image(300, 300, 'jpeg'));
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.photo, b.body.photo);
  });

  test('a PNG is converted to a JPEG', async () => {
    const res = await uploadPhoto(image(500, 400, 'png'), 'image/png');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.photo, PHOTO_KEY);
    const file = storedPhoto(res.body.photo);
    assert.equal(file.contentType, 'image/jpeg');
    assert.deepEqual(file.body.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
    assert.equal(inspect(file.body).type, 'jpeg');
    assert.deepEqual([res.body.width, res.body.height], [500, 400]);
  });

  test('the type comes from the bytes, not from the Content-Type', async () => {
    for (const type of ['application/octet-stream', 'text/plain', 'image/png']) {
      const res = await uploadPhoto(image(300, 300, 'jpeg'), type);
      assert.equal(res.status, 201, `${type} ${JSON.stringify(res.body)}`);
      assert.equal(storedPhoto(res.body.photo).contentType, 'image/jpeg', type);
    }
    const text = await uploadPhoto(Buffer.from('this is not an image, just text with a jpeg content type'), 'image/jpeg');
    assert.equal(text.status, 415);
  });

  test('EXIF and GPS data are removed and the rotation is applied', async () => {
    const res = await uploadPhoto(jpegWithExif(400, 300, 6));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.width, res.body.height], [300, 400]);
    const file = storedPhoto(res.body.photo).body;
    assert.equal(file.indexOf('Exif'), -1);
    assert.equal(file.indexOf('GPS-SECRET-LOCATION'), -1);
    assert.deepEqual([inspect(file).width, inspect(file).height], [300, 400]);

    const upright = await uploadPhoto(jpegWithExif(400, 300, 1));
    assert.equal(upright.status, 201);
    assert.equal(storedPhoto(upright.body.photo).body.indexOf('GPS-SECRET-LOCATION'), -1);
  });

  test('a large image is scaled down to 900 px on its long side; a smaller one is kept as it is', async () => {
    const cases = [
      [image(2400, 1600, 'jpeg'), 'image/jpeg', 900, 600],
      [image(1200, 2400, 'png'), 'image/png', 450, 900],
      [image(900, 900, 'jpeg'), 'image/jpeg', 900, 900],
      [image(800, 600, 'jpeg'), 'image/jpeg', 800, 600],
    ];
    for (const [body, type, width, height] of cases) {
      const res = await uploadPhoto(body, type);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual([res.body.width, res.body.height], [width, height], `${width}x${height}`);
      const info = inspect(storedPhoto(res.body.photo).body);
      assert.deepEqual([info.type, info.width, info.height], ['jpeg', width, height]);
    }
  });

  test('anything that is not a usable JPEG or PNG is refused and nothing is stored', async () => {
    const before = photoKeys();

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"></svg>');
    for (const type of ['image/svg+xml', 'image/jpeg']) {
      const res = await uploadPhoto(svg, type);
      assert.equal(res.status, 415, type);
      assert.equal(res.body.error, 'Choose a JPG or PNG photo.');
      assert.equal(res.body.code, 'unsupported_type');
    }
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(400)]);
    assert.equal((await uploadPhoto(gif, 'image/gif')).status, 415);
    assert.equal((await uploadPhoto(Buffer.from('plain text'), 'text/plain')).status, 415);

    const tiny = await uploadPhoto(image(100, 100, 'jpeg'));
    assert.equal(tiny.status, 400);
    assert.match(tiny.body.error, /at least 200/);
    assert.equal((await uploadPhoto(image(120, 400, 'png'), 'image/png')).status, 400);

    assert.equal((await uploadPhoto(image(400, 400, 'png').subarray(0, 200), 'image/png')).status, 400, 'truncated file');

    const huge = await uploadPhoto(Buffer.concat([image(300, 300, 'jpeg'), Buffer.alloc(5 * 1024 * 1024)]));
    assert.equal(huge.status, 413);

    assert.deepEqual(photoKeys(), before);
  });

  test('an empty upload is refused', async () => {
    const before = photoKeys();
    const empty = await uploadPhoto(Buffer.alloc(0));
    assert.equal(empty.status, 400, JSON.stringify(empty.body));
    assert.equal(empty.body.error, 'Choose an image file to upload.');
    const none = await request(app).post('/api/public/photos');
    assert.equal(none.status, 400, JSON.stringify(none.body));
    assert.deepEqual(photoKeys(), before);
  });

  test('closed registration refuses photos too', async () => {
    const before = photoKeys();
    env.registrationOpen = false;
    try {
      const res = await uploadPhoto(image(400, 400, 'jpeg'));
      assert.equal(res.status, 403);
      assert.match(res.body.error, /closed/);
    } finally {
      env.registrationOpen = true;
    }
    assert.deepEqual(photoKeys(), before);
    assert.equal((await uploadPhoto(image(400, 400, 'jpeg'))).status, 201, 'open again');
  });

  test('when Spaces is down the upload fails and nothing is saved', async (t) => {
    t.mock.method(console, 'error', () => {});
    const before = photoKeys();
    const objects = spaces.objects.size;
    spaces.failPuts = true;
    let res;
    try {
      res = await uploadPhoto(image(400, 400, 'jpeg'));
    } finally {
      spaces.failPuts = false;
    }
    assert.ok(res.status >= 500 && res.status < 600, String(res.status));
    assert.equal(res.body.photo, undefined);
    assert.deepEqual(photoKeys(), before);
    assert.equal(spaces.objects.size, objects);
    assert.equal((await uploadPhoto(image(400, 400, 'jpeg'))).status, 201, 'works again once Spaces is back');
  });
});

describe('photo on the registration', () => {
  let phone = 0;
  const mobile = () => `98400${String(phone++).padStart(5, '0')}`;

  test('the photo is required: missing, empty or not a string is refused', async () => {
    const count = await Registration.countDocuments();
    const { photo, ...noPhoto } = sampleV3({ mobile: mobile() });
    const missing = await submit(noPhoto);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.fields.photo, 'Please add your photo');
    for (const bad of [null, '', '   ', 123, true, [TEST_PHOTO], { key: TEST_PHOTO }]) {
      const r = await submit(sampleV3({ mobile: mobile(), photo: bad }));
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.fields.photo, 'Please add your photo', JSON.stringify(bad));
    }
    assert.equal(await Registration.countDocuments(), count);
  });

  test('a missing photo is reported together with the other errors', async () => {
    const { photo, ...rest } = sampleV3({ name: 'A', mobile: mobile() });
    const r = await submit(rest);
    assert.equal(r.status, 400);
    assert.ok(r.body.fields.name);
    assert.equal(r.body.fields.photo, 'Please add your photo');
  });

  test('a malformed photo key is refused', async () => {
    const count = await Registration.countDocuments();
    const bad = [
      'photo.jpg',
      'abc.jpg',
      TEST_PHOTO.toUpperCase(),
      TEST_PHOTO.replace('.jpg', '.png'),
      TEST_PHOTO.replace('.jpg', ''),
      `${TEST_PHOTO} `,
      `/${TEST_PHOTO}`,
      `photos/${TEST_PHOTO}`,
      `../photos/${TEST_PHOTO}`,
      `${TEST_PHOTO}/../${TEST_PHOTO}`,
      `${'a'.repeat(31)}.jpg`,
      `${'a'.repeat(33)}.jpg`,
      `${'a'.repeat(64)}.jpg`,
      `${'g'.repeat(32)}.jpg`,
      `https://cdn.test.example/TEST/photos/${TEST_PHOTO}`,
    ];
    for (const photo of bad) {
      const r = await submit(sampleV3({ mobile: mobile(), photo }));
      assert.equal(r.status, 400, photo);
      assert.equal(r.body.fields.photo, 'Please add your photo', photo);
    }
    assert.equal(await Registration.countDocuments(), count);
  });

  test('a well-formed key that was never uploaded is refused and nothing is saved', async () => {
    const count = await Registration.countDocuments();
    const passes = await EntryPass.countDocuments();
    const stored = spaces.keys('passes/').length;
    const r = await submit(sampleV3({ mobile: mobile(), photo: `${'f'.repeat(32)}.jpg` }));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'Please correct the highlighted fields.');
    assert.equal(r.body.fields.photo, 'Your photo did not upload. Please add it again.');
    assert.equal(await Registration.countDocuments(), count);
    assert.equal(await EntryPass.countDocuments(), passes);
    assert.equal(spaces.keys('passes/').length, stored);
  });

  test('an uploaded photo is saved with the registration and printed on the pass', async () => {
    const up = await uploadPhoto(image(600, 800, 'jpeg', '#1a8a3c'));
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const key = up.body.photo;

    const res = await submit(sampleV3({ name: 'Photo Person', mobile: mobile(), photo: key }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const reg = await Registration.findOne({ regNo: res.body.regNo });
    assert.equal(reg.photo, key);
    assert.equal(reg.formVersion, 3);

    const pass = await EntryPass.findOne({ registration: reg._id });
    assert.equal(pass.holder.photo, key);
    assert.ok(pass.imageKey, 'the pass image is stored');
    const png = spaces.objects.get(`TEST/passes/${pass.imageKey}`);
    assert.ok(png, 'the pass image is in Spaces');
    assert.equal(res.body.pass.imageUrl, `https://cdn.test.example/TEST/passes/${pass.imageKey}`);
    assert.deepEqual(pngSize(png.body), PASS_SIZE);

    // The photo itself is drawn on the pass: the frame's window above the DELEGATE band is its colour.
    const img = await loadImage(png.body);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(463, 700, 1, 1).data;
    for (const [got, want] of [[r, 0x1a], [g, 0x8a], [b, 0x3c]]) assert.ok(Math.abs(got - want) <= 12, `pixel ${[r, g, b]}`);

    // The photo stays in Spaces and shows in the admin views.
    assert.ok(storedPhoto(key));
    const detail = (await admin.get(`/api/admin/registrations/${reg._id}`)).body;
    assert.equal(detail.registration.photoUrl, cdnPhoto(key));
    assert.equal(detail.pass.holder.photo, key);
    const item = (await admin.get('/api/admin/registrations').query({ search: 'Photo Person' })).body.items[0];
    assert.equal(item.photoUrl, cdnPhoto(key));
  });

  test('the pass is still made when the photo cannot be read', async () => {
    const key = `${'c0ffee'.repeat(5)}ab.jpg`;
    spaces.objects.set(`TEST/photos/${key}`, { body: Buffer.from('not an image'), contentType: 'image/jpeg', acl: 'public-read', modified: new Date() });
    const res = await submit(sampleV3({ name: 'Broken Photo', mobile: mobile(), photo: key }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const reg = await Registration.findOne({ regNo: res.body.regNo });
    assert.equal(reg.photo, key);
    const pass = await EntryPass.findOne({ registration: reg._id });
    assert.deepEqual(pngSize(spaces.objects.get(`TEST/passes/${pass.imageKey}`).body), PASS_SIZE);
  });

  test('the same Idempotency-Key returns the original registration and does not save the photo again', async () => {
    const key = 'photo-key-aaaaaaaaaaaa';
    const body = sampleV3({ name: 'Photo Idem', mobile: mobile() });
    const first = await submit(body, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const objects = spaces.objects.size;
    const second = await submit(body, key);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.regNo, first.body.regNo);
    assert.equal(second.body.pass.imageUrl, first.body.pass.imageUrl);
    assert.equal(spaces.objects.size, objects, 'nothing new in Spaces');
  });
});
