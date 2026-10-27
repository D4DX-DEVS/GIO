// Read side of the conference website content.
//
// The published page settings are the single source of the event details
// (title, date, venue) used by the website, WhatsApp messages and entry
// passes, and of the registration form rules. Until something is published,
// the event details fall back to EVENT_NAME / EVENT_DATE / EVENT_VENUE.
//
// The published settings are cached briefly; publishing clears the cache in
// this process, and other processes pick the change up within CACHE_MS.
const { SiteSettings, ContentItem, Asset } = require('../models');
const { env } = require('../config/env');
const { EMPTY_PAGE, ASSET_FIELDS, plain } = require('../config/siteSchema');

const CACHE_MS = 15 * 1000;
let cache = { at: 0, page: undefined };

/** Fills in fields added after the content was saved, so old content stays readable. */
function complete(page) {
  if (!page) return null;
  return {
    ...EMPTY_PAGE,
    ...page,
    show: { ...EMPTY_PAGE.show, ...(page.show || {}) },
    form: { ...EMPTY_PAGE.form, ...(page.form || {}) },
  };
}

/** The published page settings, or null when nothing has been published yet. */
async function getPublishedPage() {
  if (cache.page !== undefined && Date.now() - cache.at < CACHE_MS) return cache.page;
  const doc = await SiteSettings.findById('site').select('published').lean();
  cache = { at: Date.now(), page: complete(doc?.published ?? null) };
  return cache.page;
}

function invalidate() {
  cache = { at: 0, page: undefined };
}

function venueLine(page) {
  if (page.venue && page.location && !page.venue.toLowerCase().includes(page.location.toLowerCase())) {
    return `${page.venue}, ${page.location}`;
  }
  return page.venue || page.location;
}

/** Event details for messages, passes and the form: { name, date, venue, supportContact }. */
async function getEvent() {
  const page = await getPublishedPage();
  if (!page) return { ...env.event };
  return {
    name: plain(page.title) || env.event.name,
    date: page.dateText || env.event.date,
    venue: venueLine(page) || env.event.venue,
    supportContact: env.event.supportContact,
  };
}

/** Admin-set registration form rules (gender options, children limits). */
async function getFormRules() {
  const page = await getPublishedPage();
  return page ? page.form : { ...EMPTY_PAGE.form };
}

/** REGISTRATION_OPEN=false always closes registration; otherwise the admin switch decides. */
async function isRegistrationOpen() {
  if (!env.registrationOpen) return false;
  const page = await getPublishedPage();
  return page ? page.registrationOpen !== false : true;
}

// --- Website payload ---------------------------------------------------------

const assetUrl = (a) => `/api/assets/${a.key}`;

function imageView(asset) {
  if (!asset) return null;
  return { id: String(asset._id), url: assetUrl(asset), alt: asset.alt, caption: asset.caption, width: asset.width, height: asset.height };
}

function collectAssetIds(page, items) {
  const ids = new Set();
  for (const f of ASSET_FIELDS.page) if (page?.[f]) ids.add(page[f]);
  for (const { kind, content } of items) for (const f of ASSET_FIELDS[kind]) if (content?.[f]) ids.add(content[f]);
  return [...ids];
}

// Text of sections that are switched off is not sent to visitors.
function stripHidden(page) {
  const p = { ...page };
  if (!p.show.theme) Object.assign(p, { themeTitle: '', themeSubtitle: '', themeBody: '' });
  if (!p.show.about) Object.assign(p, { aboutBody: '', aboutImage: '' });
  if (!p.show.programme) p.programmeIntro = '';
  if (!p.show.venue) Object.assign(p, { venueAddress: '', mapUrl: '' });
  if (!p.show.contact) Object.assign(p, { phone: '', whatsapp: '', email: '', facebook: '', instagram: '', youtube: '' });
  return p;
}

function itemStatus(doc) {
  if (!doc.published) return 'draft';
  return JSON.stringify(doc.published) === JSON.stringify(doc.draft) ? 'published' : 'changed';
}

/**
 * The website as visitors see it (mode "published") or as admins preview it
 * (mode "draft": drafts, unpublished items and hidden sections included and
 * marked). Returns null in published mode when nothing has been published.
 */
async function buildSite(mode = 'published') {
  const preview = mode === 'draft';
  const [settings, docs] = await Promise.all([
    SiteSettings.findById('site').lean(),
    ContentItem.find(preview ? {} : { published: { $ne: null } }).sort({ order: 1, createdAt: 1 }).lean(),
  ]);
  let page = complete(preview ? settings?.draft ?? null : settings?.published ?? null);
  if (!page) {
    if (!preview) return null;
    page = complete({ ...EMPTY_PAGE });
  }
  if (!preview) page = stripHidden(page);

  const items = docs.map((d) => ({ doc: d, kind: d.kind, content: preview ? d.draft : d.published }));
  const assets = await Asset.find({ _id: { $in: collectAssetIds(page, items) } }).lean();
  const byId = new Map(assets.map((a) => [String(a._id), a]));
  const img = (id) => (id ? imageView(byId.get(String(id))) : null);

  const out = { programme: [], speaker: [], announcement: [], faq: [], gallery: [] };
  for (const { doc, kind, content } of items) {
    const base = { id: String(doc._id), ...(preview ? { status: itemStatus(doc) } : {}) };
    if (kind === 'speaker') out.speaker.push({ ...base, name: content.name, role: content.role, bio: content.bio, photo: img(content.photo) });
    else if (kind === 'gallery') {
      const image = img(content.image);
      if (image) out.gallery.push({ ...base, image, caption: content.caption });
    } else out[kind].push({ ...base, ...content });
  }

  // Programme: speaker names (only speakers visible in this mode), then time order.
  const speakerNames = new Map(out.speaker.map((s) => [s.id, s.name]));
  const programme = out.programme
    .map(({ speakerIds = [], ...p }) => ({ ...p, speakers: speakerIds.map((id) => speakerNames.get(id)).filter(Boolean) }))
    .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));

  return {
    preview,
    registrationOpen: env.registrationOpen && page.registrationOpen !== false,
    page: { ...page, logo: img(page.logo), poster: img(page.poster), aboutImage: img(page.aboutImage), form: undefined },
    programme,
    speakers: out.speaker,
    announcements: out.announcement,
    faqs: out.faq,
    gallery: out.gallery,
    publishedAt: settings?.publishedAt ?? null,
  };
}

module.exports = { getPublishedPage, getEvent, getFormRules, isRegistrationOpen, invalidate, buildSite, imageView, assetUrl, complete };
