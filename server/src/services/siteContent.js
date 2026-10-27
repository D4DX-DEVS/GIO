// Write side of the conference website content: save drafts, publish,
// unpublish, reorder and delete. Every write carries the version the admin
// was editing; if someone else saved in between, the write is refused (409)
// instead of silently overwriting their change.
const mongoose = require('mongoose');
const { SiteSettings, ContentItem, Asset, EntryPass } = require('../models');
const { HttpError } = require('../utils/httpError');
const { pageSettings, ITEM_SCHEMAS, EMPTY_PAGE, EMPTY_ITEMS, ASSET_FIELDS } = require('../config/siteSchema');
const site = require('./site');

const KEEP_PREVIOUS = 5;

const STALE = () =>
  new HttpError(409, 'This was changed by another admin. Reload to see the latest version, then make your change again.', { code: 'stale' });

function validationError(zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.code === 'unrecognized_keys' ? `Unexpected field: ${issue.keys.join(', ')}` : issue.message;
  }
  return new HttpError(400, 'Please correct the highlighted fields.', { fields });
}

function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function parseVersion(v) {
  if (!Number.isInteger(v) || v < 0) throw new HttpError(400, 'Missing or invalid version.');
  return v;
}

async function checkAssets(content, fields) {
  const bad = {};
  const ids = fields.filter((f) => content[f]).map((f) => [f, content[f]]);
  if (!ids.length) return;
  const found = new Set((await Asset.find({ _id: { $in: ids.map(([, id]) => id) } }).select('_id').lean()).map((a) => String(a._id)));
  for (const [f, id] of ids) if (!found.has(id)) bad[f] = 'This image no longer exists. Choose another.';
  if (Object.keys(bad).length) throw new HttpError(400, 'Please correct the highlighted fields.', { fields: bad });
}

async function checkSpeakers(ids) {
  if (!ids.length) return;
  const n = await ContentItem.countDocuments({ _id: { $in: ids }, kind: 'speaker' });
  if (n !== new Set(ids).size) throw new HttpError(400, 'Please correct the highlighted fields.', { fields: { speakerIds: 'A selected speaker no longer exists.' } });
}

const by = (actor) => ({ updatedBy: actor.id, updatedByName: actor.name });

// --- Page settings -----------------------------------------------------------

function settingsView(doc, extra = {}) {
  const draft = site.complete(doc?.draft ?? null) ?? { ...EMPTY_PAGE };
  const published = site.complete(doc?.published ?? null);
  return {
    draft,
    published,
    version: doc?.version ?? 0,
    updatedAt: doc?.updatedAt ?? null,
    updatedByName: doc?.updatedByName ?? '',
    publishedAt: doc?.publishedAt ?? null,
    publishedByName: doc?.publishedByName ?? '',
    hasUnpublishedChanges: !published || JSON.stringify(draft) !== JSON.stringify(published),
    ...extra,
  };
}

async function getSettings() {
  const [doc, passesIssued] = await Promise.all([SiteSettings.findById('site').lean(), EntryPass.countDocuments({ status: 'active' })]);
  // Shown with the warning that event changes reach passes drawn from now on.
  return settingsView(doc, { passesIssued });
}

async function saveSettings(input, version, actor) {
  parseVersion(version);
  const draft = parse(pageSettings, input);
  await checkAssets(draft, ASSET_FIELDS.page);

  let doc;
  if (version === 0) {
    try {
      doc = await SiteSettings.create({ _id: 'site', draft, ...by(actor) });
    } catch (err) {
      if (err.code === 11000) throw STALE();
      throw err;
    }
  } else {
    doc = await SiteSettings.findOneAndUpdate({ _id: 'site', version }, { $set: { draft, ...by(actor) }, $inc: { version: 1 } }, { new: true });
    if (!doc) throw STALE();
  }
  return settingsView(doc.toObject());
}

async function publishSettings(version, actor) {
  parseVersion(version);
  const current = await SiteSettings.findById('site').lean();
  if (!current || current.version !== version) throw STALE();
  // The draft is validated again: rules may have tightened since it was saved.
  const draft = parse(pageSettings, site.complete(current.draft));
  await checkAssets(draft, ASSET_FIELDS.page);
  const now = new Date();
  const previous = current.published
    ? [{ content: current.published, publishedAt: current.publishedAt, publishedByName: current.publishedByName }, ...(current.previous || [])].slice(0, KEEP_PREVIOUS)
    : current.previous || [];
  const doc = await SiteSettings.findOneAndUpdate(
    { _id: 'site', version },
    { $set: { draft, published: draft, publishedAt: now, publishedByName: actor.name, previous, ...by(actor) }, $inc: { version: 1 } },
    { new: true }
  );
  if (!doc) throw STALE();
  site.invalidate();
  return settingsView(doc.toObject());
}

async function discardSettings(version, actor) {
  parseVersion(version);
  const current = await SiteSettings.findById('site').lean();
  if (!current || current.version !== version) throw STALE();
  if (!current.published) throw new HttpError(409, 'Nothing has been published yet, so there is nothing to go back to.');
  const doc = await SiteSettings.findOneAndUpdate(
    { _id: 'site', version },
    { $set: { draft: current.published, ...by(actor) }, $inc: { version: 1 } },
    { new: true }
  );
  if (!doc) throw STALE();
  return settingsView(doc.toObject());
}

// --- Items -------------------------------------------------------------------

function checkKind(kind) {
  if (!ITEM_SCHEMAS[kind]) throw new HttpError(404, 'Unknown content type.');
}

function checkId(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id.');
}

function itemView(doc) {
  const published = doc.published ?? null;
  return {
    id: String(doc._id),
    kind: doc.kind,
    draft: { ...EMPTY_ITEMS[doc.kind], ...doc.draft },
    published,
    status: !published ? 'draft' : JSON.stringify(published) === JSON.stringify(doc.draft) ? 'published' : 'changed',
    order: doc.order,
    version: doc.version,
    updatedAt: doc.updatedAt,
    updatedByName: doc.updatedByName,
    publishedAt: doc.publishedAt,
  };
}

async function listItems(kind) {
  checkKind(kind);
  const docs = await ContentItem.find({ kind }).sort({ order: 1, createdAt: 1 }).lean();
  return docs.map(itemView);
}

async function validateItem(kind, input) {
  const data = parse(ITEM_SCHEMAS[kind], input);
  await checkAssets(data, ASSET_FIELDS[kind]);
  if (kind === 'programme') await checkSpeakers(data.speakerIds);
  return data;
}

async function createItem(kind, input, actor) {
  checkKind(kind);
  const draft = await validateItem(kind, input);
  const last = await ContentItem.findOne({ kind }).sort({ order: -1 }).select('order').lean();
  const doc = await ContentItem.create({ kind, draft, order: (last?.order ?? 0) + 1, createdByName: actor.name, ...by(actor) });
  return itemView(doc.toObject());
}

async function findItem(kind, id) {
  checkKind(kind);
  checkId(id);
  const doc = await ContentItem.findOne({ _id: id, kind }).lean();
  if (!doc) throw new HttpError(404, 'This item no longer exists.');
  return doc;
}

async function guardedUpdate(kind, id, version, update) {
  parseVersion(version);
  const doc = await ContentItem.findOneAndUpdate({ _id: id, kind, version }, { ...update, $inc: { version: 1 } }, { new: true }).lean();
  if (!doc) {
    await findItem(kind, id); // 404 when it was deleted
    throw STALE();
  }
  return itemView(doc);
}

async function updateItem(kind, id, input, version, actor) {
  await findItem(kind, id);
  const draft = await validateItem(kind, input);
  return guardedUpdate(kind, id, version, { $set: { draft, ...by(actor) } });
}

async function publishItem(kind, id, version, actor) {
  const current = await findItem(kind, id);
  const draft = await validateItem(kind, current.draft);
  return guardedUpdate(kind, id, version, { $set: { draft, published: draft, publishedAt: new Date(), ...by(actor) } });
}

async function unpublishItem(kind, id, version, actor) {
  await findItem(kind, id);
  return guardedUpdate(kind, id, version, { $set: { published: null, ...by(actor) } });
}

async function deleteItem(kind, id) {
  const doc = await findItem(kind, id);
  if (kind === 'speaker') {
    // Programme items keep working: the speaker simply drops out of them.
    await ContentItem.updateMany({ kind: 'programme', 'draft.speakerIds': String(doc._id) }, { $pull: { 'draft.speakerIds': String(doc._id) }, $inc: { version: 1 } });
    await ContentItem.updateMany({ kind: 'programme', 'published.speakerIds': String(doc._id) }, { $pull: { 'published.speakerIds': String(doc._id) } });
  }
  await ContentItem.deleteOne({ _id: doc._id });
  return { ok: true };
}

/** Swaps the item with its neighbour in the list order. */
async function moveItem(kind, id, direction) {
  if (!['up', 'down'].includes(direction)) throw new HttpError(400, 'Direction must be "up" or "down".');
  const doc = await findItem(kind, id);
  const neighbour = await ContentItem.findOne({ kind, order: direction === 'up' ? { $lt: doc.order } : { $gt: doc.order } })
    .sort({ order: direction === 'up' ? -1 : 1 })
    .lean();
  if (neighbour) {
    await ContentItem.updateOne({ _id: doc._id }, { $set: { order: neighbour.order } });
    await ContentItem.updateOne({ _id: neighbour._id }, { $set: { order: doc.order } });
  }
  return listItems(kind);
}

const PAGE_FIELD_LABEL = { logo: 'Logo', poster: 'Poster', aboutImage: 'About image' };
const KIND_LABEL = { speaker: 'Speaker', gallery: 'Gallery' };

/**
 * Where each image is used, as readable labels keyed by image id, e.g.
 * "Page content: Poster" or "Speaker: <name>". Drafts count as use, so an
 * image cannot be deleted from under an unpublished change.
 */
async function usageMap() {
  const map = new Map();
  const add = (id, label) => {
    if (!id) return;
    const list = map.get(String(id)) || [];
    if (!list.includes(label)) list.push(label);
    map.set(String(id), list);
  };
  const [settings, items] = await Promise.all([
    SiteSettings.findById('site').lean(),
    ContentItem.find({ kind: { $in: Object.keys(KIND_LABEL) } }).lean(),
  ]);
  for (const f of ASSET_FIELDS.page) {
    for (const copy of [settings?.draft, settings?.published]) add(copy?.[f], `Page content: ${PAGE_FIELD_LABEL[f]}`);
  }
  for (const d of items) {
    for (const f of ASSET_FIELDS[d.kind]) {
      for (const copy of [d.draft, d.published]) add(copy?.[f], `${KIND_LABEL[d.kind]}: ${d.draft.name || d.draft.caption || 'image'}`);
    }
  }
  return map;
}

module.exports = {
  getSettings,
  saveSettings,
  publishSettings,
  discardSettings,
  listItems,
  createItem,
  updateItem,
  publishItem,
  unpublishItem,
  deleteItem,
  moveItem,
  usageMap,
};
