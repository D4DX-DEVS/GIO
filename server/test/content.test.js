// Conference website content: permissions, drafts and publishing, version
// conflicts, the public payload, event details reaching messages and passes,
// and image upload, replacement and removal.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { start, stop, login, sample, image, jpegWithExif, request, env } = require('./helpers');
const { createApp } = require('../src/app');
const { Registration, EntryPass } = require('../src/models');
const { mockOutbox } = require('../src/providers/dxing');
const { EMPTY_PAGE } = require('../src/config/siteSchema');
const site = require('../src/services/site');
const store = require('../src/providers/assetStore');

let app;
let admin;
const H = { 'X-Requested-With': 'rms' };

const page = (over = {}) => ({
  ...EMPTY_PAGE,
  presenter: 'GIO Keralam presents',
  title: 'International Conference on *Women*',
  dateText: '15 November 2026',
  location: 'Ernakulam',
  themeTitle: 'Being, *Becoming,* Belonging',
  themeSubtitle: 'Reimagining the Self, Space and Society',
  themeBody: 'Theme text',
  ...over,
});

const getSettings = async () => (await admin.get('/api/admin/website/settings')).body;
const save = (draft, version) => admin.put('/api/admin/website/settings').set(H).send({ draft, version });
const publish = (version) => admin.post('/api/admin/website/settings/publish').set(H).send({ version });

async function saveAndPublish(over) {
  const s = await getSettings();
  const saved = await save({ ...s.draft, ...over }, s.version);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const pub = await publish(saved.body.version);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  return pub.body;
}

const upload = (agent, buffer, alt = 'A test image', extra = '') =>
  agent
    .post(`/api/admin/website/assets?alt=${encodeURIComponent(alt)}${extra}`)
    .set(H)
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', 'test.png')
    .send(buffer);

before(async () => {
  app = await start();
  admin = await login(app);
});

after(stop);

describe('access', () => {
  test('signed-out users get 401, admins get in', async () => {
    assert.equal((await request(app).get('/api/admin/website/settings')).status, 401);
    assert.equal((await admin.get('/api/admin/website/settings')).status, 200);
  });

  test('writes need the CSRF header', async () => {
    const r = await admin.put('/api/admin/website/settings').send({ draft: page(), version: 0 });
    assert.equal(r.status, 403);
  });
});

describe('page settings', () => {
  test('nothing is public before the first publish; event details come from the environment', async () => {
    const r = await request(app).get('/api/public/site');
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'not_published');
    const c = (await request(app).get('/api/public/config')).body;
    assert.equal(c.eventName, 'Test Conference');
    assert.deepEqual(c.genderOptions, []);
    assert.equal(c.children, null);
  });

  test('validation: required title, safe links, consistent form rules, no unknown fields', async () => {
    const bad = await save(page({ title: '', mapUrl: 'javascript:alert(1)', facebook: 'ftp://x', extra: 1 }), 0);
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields._ || bad.body.fields.extra, JSON.stringify(bad.body.fields));
    const bad2 = await save(page({ title: '', mapUrl: 'javascript:alert(1)' }), 0);
    assert.match(bad2.body.fields.title, /required/);
    assert.match(bad2.body.fields.mapUrl, /https/);
    const half = await save(page({ form: { genderOptions: [], childrenMax: 3, childAgeMin: null, childAgeMax: null } }), 0);
    assert.match(half.body.fields['form.childrenMax'], /all three/);
    const inverted = await save(page({ form: { genderOptions: [], childrenMax: 3, childAgeMin: 10, childAgeMax: 5 } }), 0);
    assert.match(inverted.body.fields['form.childAgeMin'], /above/);
    const dupes = await save(page({ form: { genderOptions: ['A', 'a'], childrenMax: null, childAgeMin: null, childAgeMax: null } }), 0);
    assert.match(dupes.body.fields['form.genderOptions'], /different/);
  });

  test('save creates a draft that visitors do not see; a stale version is refused', async () => {
    const created = await save(page(), 0);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.version, 1);
    assert.equal(created.body.hasUnpublishedChanges, true);
    assert.equal((await request(app).get('/api/public/site')).status, 404);

    const again = await save(page(), 0);
    assert.equal(again.status, 409);
    const old = await save(page({ location: 'Old' }), 5);
    assert.equal(old.status, 409);
    assert.equal(old.body.code, 'stale');
  });

  test('publish makes it public and changes event details for messages and passes', async () => {
    const s = await getSettings();
    const pub = await publish(s.version);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.hasUnpublishedChanges, false);

    const pubSite = await request(app).get('/api/public/site');
    assert.equal(pubSite.status, 200);
    assert.equal(pubSite.headers['cache-control'], 'no-cache');
    assert.equal(pubSite.body.page.title, 'International Conference on *Women*');
    assert.equal(pubSite.body.page.form, undefined, 'form rules are served with /config');

    const c = (await request(app).get('/api/public/config')).body;
    assert.equal(c.eventName, 'International Conference on Women');
    assert.equal(c.eventDate, '15 November 2026');
    assert.equal(c.eventVenue, 'Ernakulam');

    // The confirmation message and pass use the published details.
    const res = await request(app).post('/api/public/registrations').send(sample());
    assert.equal(res.status, 201);
    const reg = await Registration.findOne({ regNo: res.body.regNo });
    const before = mockOutbox.length;
    const ok = await admin.post(`/api/admin/registrations/${reg._id}/actions/confirm`).set(H).send({});
    assert.equal(ok.status, 200);
    const [confirmMsg, passMsg] = mockOutbox.slice(before);
    assert.match(confirmMsg.message, /International Conference on Women/);
    assert.match(confirmMsg.message, /Date: 15 November 2026/);
    assert.match(confirmMsg.message, /Venue: Ernakulam/);
    assert.match(passMsg.message, /Entry pass - International Conference on Women/);
    const pass = await EntryPass.findOne({ registration: reg._id });
    assert.deepEqual({ ...pass.eventSnapshot.toObject() }, { name: 'International Conference on Women', date: '15 November 2026', venue: 'Ernakulam' });
  });

  test('a later draft change stays private until published; preview shows it', async () => {
    const s = await getSettings();
    const saved = await save({ ...s.draft, venue: 'Town Hall' }, s.version);
    assert.equal(saved.body.hasUnpublishedChanges, true);
    assert.equal((await request(app).get('/api/public/site')).body.page.venue, '');
    const preview = await admin.get('/api/admin/website/preview');
    assert.equal(preview.body.preview, true);
    assert.equal(preview.body.page.venue, 'Town Hall');

    // Discard goes back to the published copy.
    const discarded = await admin.post('/api/admin/website/settings/discard').set(H).send({ version: saved.body.version });
    assert.equal(discarded.status, 200);
    assert.equal(discarded.body.draft.venue, '');
    assert.equal(discarded.body.hasUnpublishedChanges, false);

    const body = await saveAndPublish({ venue: 'Town Hall' });
    assert.equal(body.published.venue, 'Town Hall');
    assert.equal((await request(app).get('/api/public/config')).body.eventVenue, 'Town Hall, Ernakulam');
  });

  test('text of hidden sections is not sent to visitors', async () => {
    await saveAndPublish({ show: { ...EMPTY_PAGE.show, theme: false }, themeBody: 'Secret draft theme text' });
    const pub = (await request(app).get('/api/public/site')).body;
    assert.equal(pub.page.show.theme, false);
    assert.equal(pub.page.themeBody, '');
    assert.equal((await admin.get('/api/admin/website/preview')).body.page.themeBody, 'Secret draft theme text');
    await saveAndPublish({ show: { ...EMPTY_PAGE.show } });
  });

  test('the admin switch closes registration; REGISTRATION_OPEN=false always wins', async () => {
    await saveAndPublish({ registrationOpen: false });
    assert.equal((await request(app).get('/api/public/config')).body.registrationOpen, false);
    assert.equal((await request(app).get('/api/public/site')).body.registrationOpen, false);
    assert.equal((await request(app).post('/api/public/registrations').send(sample({ mobile: '9000000777' }))).status, 403);

    await saveAndPublish({ registrationOpen: true });
    assert.equal((await request(app).get('/api/public/config')).body.registrationOpen, true);
    env.registrationOpen = false;
    try {
      assert.equal((await request(app).get('/api/public/config')).body.registrationOpen, false);
    } finally {
      env.registrationOpen = true;
    }
  });

  test('published content survives a restart (new app, empty cache)', async () => {
    site.invalidate();
    const fresh = createApp();
    const r = await request(fresh).get('/api/public/site');
    assert.equal(r.status, 200);
    assert.equal(r.body.page.venue, 'Town Hall');
  });
});

describe('items', () => {
  const items = (kind) => admin.get(`/api/admin/website/items/${kind}`);
  const create = (kind, data) => admin.post(`/api/admin/website/items/${kind}`).set(H).send({ data });
  const act = (kind, it, action) => admin.post(`/api/admin/website/items/${kind}/${it.id}/${action}`).set(H).send({ version: it.version });

  test('unknown kinds and invalid data are refused', async () => {
    assert.equal((await items('posters')).status, 404);
    const bad = await create('programme', { type: 'session', title: '', start: '9:00', end: '', stage: '', speakerIds: [], description: '' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields.title && bad.body.fields.start);
    const order = await create('programme', { type: 'session', title: 'X', start: '10:00', end: '09:00', stage: '', speakerIds: [], description: '' });
    assert.match(order.body.fields.end, /after/);
    const link = await create('announcement', { title: 'A', body: '', linkText: 'Go', linkUrl: 'javascript:alert(1)', pinned: false });
    assert.equal(link.status, 400);
  });

  test('programme: empty until an item is published; unpublish hides it again', async () => {
    assert.deepEqual((await request(app).get('/api/public/site')).body.programme, []);

    const speaker = (await create('speaker', { name: 'Dr Test Speaker', role: 'Sample', photo: '', bio: '' })).body;
    const created = await create('programme', {
      type: 'session',
      title: 'Opening session',
      start: '09:30',
      end: '10:15',
      stage: 'Hall A',
      speakerIds: [speaker.id],
      description: '',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'draft');
    assert.deepEqual((await request(app).get('/api/public/site')).body.programme, []);
    assert.equal((await admin.get('/api/admin/website/preview')).body.programme[0].status, 'draft');

    const pub = await act('programme', created.body, 'publish');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.status, 'published');
    const visible = (await request(app).get('/api/public/site')).body.programme;
    assert.equal(visible.length, 1);
    assert.equal(visible[0].title, 'Opening session');
    assert.deepEqual(visible[0].speakers, [], 'unpublished speaker is not named publicly');

    // Editing a published item leaves the public copy as it was until republished.
    const edited = await admin
      .put(`/api/admin/website/items/programme/${created.body.id}`)
      .set(H)
      .send({ version: pub.body.version, data: { ...pub.body.draft, title: 'Opening session (edited)' } });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.status, 'changed');
    assert.equal((await request(app).get('/api/public/site')).body.programme[0].title, 'Opening session');

    const stale = await admin
      .put(`/api/admin/website/items/programme/${created.body.id}`)
      .set(H)
      .send({ version: pub.body.version, data: pub.body.draft });
    assert.equal(stale.status, 409);

    const un = await act('programme', edited.body, 'unpublish');
    assert.equal(un.body.status, 'draft');
    assert.deepEqual((await request(app).get('/api/public/site')).body.programme, []);
  });

  test('speakers: publish shows the name in the programme; delete removes it from sessions', async () => {
    const speakers = (await items('speaker')).body.items;
    const s = speakers[0];
    await act('speaker', s, 'publish');
    const prog = (await items('programme')).body.items[0];
    await act('programme', prog, 'publish');
    assert.deepEqual((await request(app).get('/api/public/site')).body.programme[0].speakers, ['Dr Test Speaker']);

    assert.equal((await admin.delete(`/api/admin/website/items/speaker/${s.id}`).set(H)).status, 200);
    const after = (await items('programme')).body.items[0];
    assert.deepEqual(after.draft.speakerIds, []);
    assert.deepEqual((await request(app).get('/api/public/site')).body.programme[0].speakers, []);
  });

  test('FAQs keep the order admins set', async () => {
    const a = (await create('faq', { question: 'First?', answer: 'One' })).body;
    const b = (await create('faq', { question: 'Second?', answer: 'Two' })).body;
    await act('faq', a, 'publish');
    await act('faq', b, 'publish');
    const moved = await admin.post(`/api/admin/website/items/faq/${b.id}/move`).set(H).send({ direction: 'up' });
    assert.deepEqual(moved.body.items.map((i) => i.draft.question), ['Second?', 'First?']);
    assert.deepEqual((await request(app).get('/api/public/site')).body.faqs.map((f) => f.question), ['Second?', 'First?']);
    assert.equal((await admin.delete(`/api/admin/website/items/faq/${a.id}`).set(H)).status, 200);
    assert.equal((await admin.delete(`/api/admin/website/items/faq/${a.id}`).set(H)).status, 404);
  });
});

describe('images', () => {
  let asset;

  test('upload: JPEG and PNG only, checked from the bytes; alt text required', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"></svg>');
    const r1 = await upload(admin, svg);
    assert.equal(r1.status, 415);
    const fake = await admin
      .post('/api/admin/website/assets?alt=x')
      .set(H)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('this is not an image, just text with a png content type'));
    assert.equal(fake.status, 415);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(400)]);
    assert.equal((await upload(admin, gif)).status, 415);
    assert.equal((await upload(admin, image(300, 300), '')).status, 400);
    assert.match((await upload(admin, image(120, 400))).body.error, /at least 200/);
    const truncated = image(400, 400, 'png').subarray(0, 200);
    assert.equal((await upload(admin, truncated)).status, 400);
    const big = Buffer.concat([image(300, 300), Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await upload(admin, big)).status, 413);
    // A header claiming a huge image is refused before decoding.
    const bomb = Buffer.from(image(300, 300));
    bomb.writeUInt32BE(20000, 16);
    bomb.writeUInt32BE(20000, 20);
    assert.match((await upload(admin, bomb)).body.error, /megapixels/);
  });

  test('upload stores a re-encoded image, served from a hash URL with a long cache', async () => {
    const r = await upload(admin, image(2400, 1200, 'png'), 'Conference poster', '&caption=Official%20poster');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    asset = r.body;
    assert.equal(asset.width, 1600);
    assert.equal(asset.height, 800);
    assert.equal(asset.alt, 'Conference poster');
    assert.equal(asset.caption, 'Official poster');
    assert.match(asset.url, /^\/api\/assets\/[a-f0-9]{64}\.png$/);
    const file = await request(app).get(asset.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.match(file.headers['cache-control'], /immutable/);
    assert.equal((await request(app).get('/api/assets/../../etc/passwd')).status, 404);
    assert.equal((await request(app).get(`/api/assets/${'0'.repeat(64)}.png`)).status, 404);
  });

  test('EXIF (including location) is removed and the rotation applied', async () => {
    const r = await upload(admin, jpegWithExif(400, 300, 6), 'Rotated photo');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.width, 300);
    assert.equal(r.body.height, 400);
    const file = (await request(app).get(r.body.url).buffer(true)).body;
    assert.equal(file.indexOf('Exif'), -1);
    assert.equal(file.indexOf('GPS-SECRET-LOCATION'), -1);
    assert.equal((await admin.delete(`/api/admin/website/assets/${r.body.id}`).set(H)).status, 200);
  });

  test('alt text and caption can be edited; alt cannot be emptied', async () => {
    const r = await admin.put(`/api/admin/website/assets/${asset.id}`).set(H).send({ alt: 'Poster, new alt', caption: '' });
    assert.equal(r.status, 200);
    assert.equal(r.body.alt, 'Poster, new alt');
    assert.equal((await admin.put(`/api/admin/website/assets/${asset.id}`).set(H).send({ alt: '  ' })).status, 400);
  });

  test('an image in use cannot be deleted; replace keeps it in use with a new file', async () => {
    const pub = await saveAndPublish({ poster: asset.id });
    assert.equal(pub.published.poster, asset.id);
    const pubSite = (await request(app).get('/api/public/site')).body;
    assert.equal(pubSite.page.poster.url, asset.url);
    assert.equal(pubSite.page.poster.alt, 'Poster, new alt');

    const del = await admin.delete(`/api/admin/website/assets/${asset.id}`).set(H);
    assert.equal(del.status, 409);
    assert.match(del.body.error, /Poster/);

    const replaced = await admin
      .post(`/api/admin/website/assets/${asset.id}/replace`)
      .set(H)
      .set('Content-Type', 'application/octet-stream')
      .send(image(800, 1000, 'jpeg', '#204060'));
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.equal(replaced.body.id, asset.id);
    assert.notEqual(replaced.body.url, asset.url);
    assert.match(replaced.body.url, /\.jpg$/);
    assert.deepEqual(replaced.body.usedIn, ['Page content: Poster']);
    assert.equal((await request(app).get(asset.url)).status, 404, 'old file removed');
    assert.equal((await request(app).get('/api/public/site')).body.page.poster.url, replaced.body.url);
    asset = replaced.body;
  });

  test('a page referring to a deleted image is refused; remove then delete works', async () => {
    const bogus = await save({ ...(await getSettings()).draft, logo: 'a'.repeat(24) }, (await getSettings()).version);
    assert.equal(bogus.status, 400);
    assert.match(bogus.body.fields.logo, /no longer exists/);

    await saveAndPublish({ poster: '' });
    // Still referenced by the previous published copy? No: draft and published both cleared.
    const del = await admin.delete(`/api/admin/website/assets/${asset.id}`).set(H);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal((await request(app).get(asset.url)).status, 404);
    assert.equal((await admin.get('/api/admin/website/assets')).body.assets.find((a) => a.id === asset.id), undefined);
  });

  test('images survive a restart', async () => {
    const r = await upload(admin, image(400, 400), 'Logo');
    site.invalidate();
    const fresh = createApp();
    assert.equal((await request(fresh).get(r.body.url)).status, 200);
  });

  test('local disk storage works the same way', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gio-assets-'));
    const saved = { ...env.assets };
    Object.assign(env.assets, { storage: 'local', dir });
    try {
      const r = await upload(admin, image(300, 300, 'jpeg'), 'Local image');
      assert.equal(r.status, 201);
      assert.ok(fs.existsSync(path.join(dir, r.body.url.split('/').pop())));
      assert.equal((await request(app).get(r.body.url)).status, 200);
      assert.deepEqual(await store.list(), [r.body.url.split('/').pop()]);
      assert.equal((await admin.delete(`/api/admin/website/assets/${r.body.id}`).set(H)).status, 200);
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally {
      Object.assign(env.assets, saved);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
