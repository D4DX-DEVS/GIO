// Website > Programme, Speakers, Announcements, FAQs and Gallery: one screen
// for every list. New items start as drafts; Publish shows them on the
// website, Unpublish hides them again, Delete removes them.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Eye, EyeOff, ListChecks, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../../lib/api';
import type { ContentItem, ItemData, ItemKind } from '../../../lib/types';
import { formatDateTime } from '../../../lib/format';
import { timeRange } from '../../../lib/site';
import { Alert, Button, Dialog, EmptyState, Field, Skeleton, cx, useToast } from '../../../components/ui';
import { ImageField, StatusPill, TextArea, TextInput, Toggle } from '../../../components/website';

type FieldDef =
  | { key: string; label: string; type: 'text' | 'url' | 'time'; max?: number; hint?: string; half?: boolean }
  | { key: string; label: string; type: 'textarea'; max?: number; hint?: string }
  | { key: string; label: string; type: 'select'; options: Array<[string, string]>; half?: boolean }
  | { key: string; label: string; type: 'checkbox'; description?: string }
  | { key: string; label: string; type: 'image'; hint?: string }
  | { key: string; label: string; type: 'speakers' };

type KindDef = {
  kind: ItemKind;
  title: string;
  singular: string;
  intro: string;
  empty: string;
  fields: FieldDef[];
  summary: (d: Record<string, unknown>) => { title: string; meta?: string };
  reorder: boolean;
};

export const KINDS: Record<string, KindDef> = {
  programme: {
    kind: 'programme',
    title: 'Programme',
    singular: 'programme item',
    intro: 'Sessions and breaks appear on the website in time order. While nothing is published, the website shows “Programme will be announced soon.”',
    empty: 'No programme items yet. Add them once the programme is confirmed.',
    reorder: false,
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: [['session', 'Session'], ['break', 'Break']], half: true },
      { key: 'stage', label: 'Hall or stage', type: 'text', max: 120, half: true },
      { key: 'title', label: 'Title', type: 'text', max: 200 },
      { key: 'start', label: 'Start time', type: 'time', half: true, hint: 'Leave empty if not confirmed' },
      { key: 'end', label: 'End time', type: 'time', half: true },
      { key: 'speakerIds', label: 'Speakers', type: 'speakers' },
      { key: 'description', label: 'Description', type: 'textarea', max: 1500 },
    ],
    summary: (d) => ({ title: String(d.title), meta: timeRange(String(d.start), String(d.end)) || 'Time to be confirmed' }),
  },
  speakers: {
    kind: 'speaker',
    title: 'Speakers',
    singular: 'speaker',
    intro: 'Add speakers once they are confirmed. Get the speaker’s consent before publishing a photo.',
    empty: 'No speakers yet.',
    reorder: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', max: 120 },
      { key: 'role', label: 'Designation', type: 'text', max: 200 },
      { key: 'photo', label: 'Photo', type: 'image' },
      { key: 'bio', label: 'Biography', type: 'textarea', max: 3000 },
    ],
    summary: (d) => ({ title: String(d.name), meta: String(d.role || '') }),
  },
  announcements: {
    kind: 'announcement',
    title: 'Announcements',
    singular: 'announcement',
    intro: 'A pinned announcement also appears in a bar above the header.',
    empty: 'No announcements yet.',
    reorder: true,
    fields: [
      { key: 'title', label: 'Title', type: 'text', max: 160 },
      { key: 'body', label: 'Text', type: 'textarea', max: 1000 },
      { key: 'linkText', label: 'Link text', type: 'text', max: 60, half: true },
      { key: 'linkUrl', label: 'Link', type: 'url', max: 500, half: true, hint: 'https://… or /register' },
      { key: 'pinned', label: 'Pin above the header', type: 'checkbox' },
    ],
    summary: (d) => ({ title: String(d.title), meta: d.pinned ? 'Pinned' : '' }),
  },
  faqs: {
    kind: 'faq',
    title: 'FAQs',
    singular: 'question',
    intro: 'Shown in the order set here.',
    empty: 'No questions yet.',
    reorder: true,
    fields: [
      { key: 'question', label: 'Question', type: 'text', max: 300 },
      { key: 'answer', label: 'Answer', type: 'textarea', max: 3000 },
    ],
    summary: (d) => ({ title: String(d.question) }),
  },
  gallery: {
    kind: 'gallery',
    title: 'Gallery',
    singular: 'gallery image',
    intro: 'Pick images from the library or upload new ones. Gallery images start as drafts.',
    empty: 'No gallery images yet.',
    reorder: true,
    fields: [
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'caption', label: 'Caption', type: 'text', max: 300 },
    ],
    summary: (d) => ({ title: String(d.caption || 'Untitled image') }),
  },
};

const EMPTY: { [K in ItemKind]: ItemData[K] } = {
  programme: { type: 'session', title: '', start: '', end: '', stage: '', speakerIds: [], description: '' },
  speaker: { name: '', role: '', photo: '', bio: '' },
  announcement: { title: '', body: '', linkText: '', linkUrl: '', pinned: false },
  faq: { question: '', answer: '' },
  gallery: { image: '', caption: '' },
};

export default function ItemsPage({ slug }: { slug: keyof typeof KINDS }) {
  const def = KINDS[slug];
  const toast = useToast();
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ item: ContentItem | null; data: Record<string, unknown> } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [speakers, setSpeakers] = useState<ContentItem<'speaker'>[]>([]);

  const base = `/api/admin/website/items/${def.kind}`;

  const load = useCallback(() => {
    setError('');
    api<{ items: ContentItem[] }>(base)
      .then((r) => setItems(r.items))
      .catch((err) => setError(errorMessage(err)));
    if (def.kind === 'programme') {
      api<{ items: ContentItem<'speaker'>[] }>('/api/admin/website/items/speaker')
        .then((r) => setSpeakers(r.items))
        .catch(() => setSpeakers([]));
    }
  }, [base, def.kind]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  // ?add=1 (from the website overview) opens the Add dialog once.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('add') !== '1') return;
    setEditing({ item: null, data: { ...EMPTY[def.kind] } });
    const next = new URLSearchParams(params);
    next.delete('add');
    setParams(next, { replace: true });
  }, [params, setParams, def.kind]);

  const replace = (updated: ContentItem) => setItems((all) => (all ? all.map((i) => (i.id === updated.id ? updated : i)) : all));

  function handleError(err: unknown) {
    toast('error', errorMessage(err));
    if (err instanceof ApiError && (err.code === 'stale' || err.status === 404)) load();
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const res = editing.item
        ? await api<ContentItem>(`${base}/${editing.item.id}`, { method: 'PUT', body: { data: editing.data, version: editing.item.version } })
        : await api<ContentItem>(base, { method: 'POST', body: { data: editing.data } });
      if (editing.item) replace(res);
      else setItems((all) => [...(all ?? []), res]);
      setEditing(null);
      toast('success', editing.item ? 'Saved. Publish to show the change on the website.' : 'Added as a draft. Publish it to show it on the website.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      else handleError(err);
    } finally {
      setSaving(false);
    }
  }

  async function act(item: ContentItem, action: 'publish' | 'unpublish') {
    setBusyId(item.id);
    try {
      replace(await api<ContentItem>(`${base}/${item.id}/${action}`, { method: 'POST', body: { version: item.version } }));
      toast('success', action === 'publish' ? 'Published' : 'Unpublished. It is hidden from the website.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        toast('error', `${errorMessage(err)} Open the item to fix it.`);
      } else handleError(err);
    } finally {
      setBusyId('');
    }
  }

  async function move(item: ContentItem, direction: 'up' | 'down') {
    setBusyId(item.id);
    try {
      setItems((await api<{ items: ContentItem[] }>(`${base}/${item.id}/move`, { method: 'POST', body: { direction } })).items);
    } catch (err) {
      handleError(err);
    } finally {
      setBusyId('');
    }
  }

  async function remove() {
    if (!deleting) return;
    const item = deleting;
    setBusyId(item.id);
    try {
      await api(`${base}/${item.id}`, { method: 'DELETE' });
      setItems((all) => (all ? all.filter((i) => i.id !== item.id) : all));
      toast('success', 'Deleted');
    } catch (err) {
      handleError(err);
    } finally {
      setBusyId('');
      setDeleting(null);
    }
  }

  const sorted =
    items && def.kind === 'programme'
      ? [...items].sort((a, b) => String((a.draft as ItemData['programme']).start || '99:99').localeCompare(String((b.draft as ItemData['programme']).start || '99:99')))
      : items;

  const setField = (k: string, v: unknown) => {
    setEditing((e) => (e ? { ...e, data: { ...e.data, [k]: v } } : e));
    setFieldErrors((f) => ({ ...f, [k]: '' }));
  };

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <p className="kicker">Website</p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{def.intro}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <a
            href="/?preview=1"
            target="_blank"
            rel="noreferrer"
            className="btn-line inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold"
          >
            <Eye className="h-4 w-4" aria-hidden /> Preview
          </a>
          <Button className="flex-1 sm:flex-none" onClick={() => setEditing({ item: null, data: { ...EMPTY[def.kind] } })}>
            <Plus className="h-4 w-4" aria-hidden /> Add {def.singular}
          </Button>
        </div>
      </div>

      <div className="card mt-5 overflow-hidden">
        {error ? (
          <div className="p-5">
            <Alert action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{error}</Alert>
          </div>
        ) : !sorted ? (
          <div className="space-y-3 p-5" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState icon={ListChecks} title={def.empty} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {sorted.map((item, i) => {
              const d = item.draft as unknown as Record<string, unknown>;
              const s = def.summary(d);
              const busy = busyId === item.id;
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 p-4 transition-colors hover:bg-slate-50/70 sm:flex-nowrap sm:px-5">
                  {def.reorder && (
                    <span className="hidden w-6 shrink-0 text-center font-serif text-xl leading-none text-brand-300 sm:block" aria-hidden>
                      {i + 1}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-semibold text-slate-900">{s.title}</span>
                      <StatusPill status={item.status} />
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.meta ? `${s.meta} · ` : ''}
                      Updated {formatDateTime(item.updatedAt)}
                      {item.updatedByName && ` by ${item.updatedByName}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {def.reorder && (
                      <>
                        <Button size="icon" variant="ghost" disabled={busy || i === 0} onClick={() => move(item, 'up')} aria-label="Move up">
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" disabled={busy || i === sorted.length - 1} onClick={() => move(item, 'down')} aria-label="Move down">
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing({ item, data: { ...d } })}>
                      <Pencil className="h-4 w-4" aria-hidden /> Edit
                    </Button>
                    {item.status !== 'published' && (
                      <Button size="sm" loading={busy} onClick={() => act(item, 'publish')}>
                        <Send className="h-4 w-4" aria-hidden /> {item.status === 'changed' ? 'Publish changes' : 'Publish'}
                      </Button>
                    )}
                    {item.status !== 'draft' && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(item, 'unpublish')}>
                        <EyeOff className="h-4 w-4" aria-hidden /> Unpublish
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" disabled={busy} onClick={() => setDeleting(item)} aria-label={`Delete ${s.title}`}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={Boolean(editing)}
        size="lg"
        title={editing?.item ? `Edit ${def.singular}` : `Add ${def.singular}`}
        description={editing?.item?.status === 'published' ? 'The website keeps showing the published version until you publish this change.' : 'Saved as a draft.'}
        onClose={() => !saving && setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            {def.fields.map((f) => {
              const v = editing.data[f.key];
              const err = fieldErrors[f.key];
              const span = 'half' in f && f.half ? '' : 'sm:col-span-2';
              if (f.type === 'textarea')
                return <TextArea key={f.key} className={span} label={f.label} value={String(v ?? '')} onChange={(x) => setField(f.key, x)} maxLength={f.max} error={err} hint={f.hint} />;
              if (f.type === 'checkbox')
                return (
                  <div key={f.key} className={span}>
                    <Toggle label={f.label} checked={Boolean(v)} onChange={(x) => setField(f.key, x)} />
                  </div>
                );
              if (f.type === 'image')
                return (
                  <div key={f.key} className={span}>
                    <ImageField label={f.label} value={String(v ?? '')} onChange={(x) => setField(f.key, x)} error={err} hint={f.hint} />
                  </div>
                );
              if (f.type === 'select')
                return (
                  <Field key={f.key} label={f.label} error={err} className={span}>
                    {(p) => (
                      <select {...p} className="select py-3" value={String(v)} onChange={(e) => setField(f.key, e.target.value)}>
                        {f.options.map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                );
              if (f.type === 'speakers') {
                const selected = (v as string[]) ?? [];
                return (
                  <fieldset key={f.key} className={cx(span, 'min-w-0')}>
                    <legend className="mb-1.5 text-sm font-medium text-slate-700">{f.label}</legend>
                    {speakers.length === 0 ? (
                      <p className="text-sm text-slate-500">No speakers yet. Add them under Website › Speakers.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {speakers.map((s) => (
                          <label
                            key={s.id}
                            className={cx(
                              'inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
                              selected.includes(s.id) ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white hover:border-slate-300'
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-brand-600"
                              checked={selected.includes(s.id)}
                              onChange={(e) => setField(f.key, e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))}
                            />
                            {s.draft.name}
                            {s.status === 'draft' && <span className="text-xs text-amber-700">(draft)</span>}
                          </label>
                        ))}
                      </div>
                    )}
                    {err && <p className="mt-1.5 text-[13px] font-medium text-red-600">{err}</p>}
                  </fieldset>
                );
              }
              return (
                <TextInput
                  key={f.key}
                  className={span}
                  label={f.label}
                  type={f.type === 'time' ? 'time' : 'text'}
                  inputMode={f.type === 'url' ? 'url' : undefined}
                  value={String(v ?? '')}
                  onChange={(x) => setField(f.key, x)}
                  maxLength={f.max}
                  error={err}
                  hint={f.hint}
                />
              );
            })}
            {fieldErrors._ && (
              <div className="sm:col-span-2">
                <Alert>{fieldErrors._}</Alert>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        title={`Delete this ${def.singular}?`}
        description="It is removed from the website and cannot be restored. To hide it but keep it, use Unpublish instead."
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={Boolean(busyId)} onClick={remove}>
              Delete
            </Button>
          </>
        }
      />
    </main>
  );
}
