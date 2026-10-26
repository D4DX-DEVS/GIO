// Website > Page content: one form for the whole landing page, the event
// details used by messages and passes, and the registration form rules.
// Save keeps a draft; Publish makes it what visitors (and new messages and
// pass images) see.
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Eye, RotateCcw, Save, Send, TriangleAlert } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../../lib/api';
import type { PageSettings, SectionKey, SettingsResponse } from '../../../lib/types';
import { formatDateTime } from '../../../lib/format';
import { Alert, Button, Dialog, Skeleton, cx, useToast } from '../../../components/ui';
import { ImageField, SectionCard, StatusPill, TextArea, TextInput, Toggle } from '../../../components/website';

const SECTIONS: Array<[SectionKey, string]> = [
  ['updates', 'Announcements'],
  ['theme', 'Theme'],
  ['about', 'About'],
  ['programme', 'Programme'],
  ['speakers', 'Speakers'],
  ['gallery', 'Gallery'],
  ['faq', 'FAQ'],
  ['venue', 'Venue'],
  ['contact', 'Contact'],
];

// Fields that also appear in WhatsApp messages and on entry passes.
const EVENT_FIELDS: Array<keyof PageSettings> = ['title', 'dateText', 'location', 'venue'];

const numOrNull = (v: string) => (v.trim() === '' ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

export default function PageContent() {
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<PageSettings | null>(null);
  const [genderText, setGenderText] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'discard'>('');
  const [stale, setStale] = useState(false);
  const [confirm, setConfirm] = useState<'' | 'publish' | 'discard'>('');
  const { hash } = useLocation();

  function accept(res: SettingsResponse) {
    setData(res);
    setForm(res.draft);
    setGenderText(res.draft.form.genderOptions.join('\n'));
    setFields({});
    setStale(false);
  }

  const load = () => {
    setLoadError('');
    api<SettingsResponse>('/api/admin/website/settings').then(accept).catch((err) => setLoadError(errorMessage(err)));
  };
  useEffect(load, []);

  const draftForSave = useMemo(() => {
    if (!form) return null;
    return { ...form, form: { ...form.form, genderOptions: genderText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) } };
  }, [form, genderText]);

  const unsaved = Boolean(data && draftForSave && JSON.stringify(draftForSave) !== JSON.stringify(data.draft));

  useEffect(() => {
    if (!unsaved) return undefined;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Links such as /admin/website#pc-venue open the page at that card.
  const loaded = Boolean(data);
  useEffect(() => {
    if (loaded && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [loaded, hash]);

  if (loadError) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <Alert title="Website settings could not be loaded" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>
          {loadError}
        </Alert>
      </main>
    );
  }
  if (!data || !form || !draftForSave) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6 lg:px-8" aria-busy>
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </main>
    );
  }

  const set = <K extends keyof PageSettings>(k: K, v: PageSettings[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setFields((e) => ({ ...e, [k]: '' }));
  };
  const str = (k: keyof PageSettings) => (form[k] as string) ?? '';
  const input = (k: keyof PageSettings, label: string, extra: Partial<Parameters<typeof TextInput>[0]> = {}) => (
    <TextInput label={label} value={str(k)} onChange={(v) => set(k, v as never)} error={fields[k]} {...extra} />
  );
  const area = (k: keyof PageSettings, label: string, extra: Partial<Parameters<typeof TextArea>[0]> = {}) => (
    <TextArea label={label} value={str(k)} onChange={(v) => set(k, v as never)} error={fields[k]} {...extra} />
  );
  const setRule = (k: 'childrenMax' | 'childAgeMin' | 'childAgeMax', v: string) => {
    const n = numOrNull(v);
    setForm((f) => (f ? { ...f, form: { ...f.form, [k]: Number.isNaN(n) ? f.form[k] : n } } : f));
    setFields((e) => ({ ...e, [`form.${k}`]: '' }));
  };

  function onError(err: unknown) {
    if (err instanceof ApiError && err.code === 'stale') setStale(true);
    if (err instanceof ApiError && err.fields) {
      setFields(err.fields);
      toast('error', 'Some fields need attention.');
      setTimeout(() => document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    } else toast('error', errorMessage(err));
  }

  async function save() {
    setBusy('save');
    try {
      accept(await api<SettingsResponse>('/api/admin/website/settings', { method: 'PUT', body: { draft: draftForSave, version: data!.version } }));
      toast('success', 'Draft saved. Visitors do not see it until you publish.');
    } catch (err) {
      onError(err);
    } finally {
      setBusy('');
    }
  }

  async function publish() {
    setConfirm('');
    setBusy('publish');
    try {
      accept(await api<SettingsResponse>('/api/admin/website/settings/publish', { method: 'POST', body: { version: data!.version } }));
      toast('success', 'Published. The website now shows these details.');
    } catch (err) {
      onError(err);
    } finally {
      setBusy('');
    }
  }

  async function discard() {
    setConfirm('');
    setBusy('discard');
    try {
      accept(await api<SettingsResponse>('/api/admin/website/settings/discard', { method: 'POST', body: { version: data!.version } }));
      toast('info', 'Draft changes discarded.');
    } catch (err) {
      onError(err);
    } finally {
      setBusy('');
    }
  }

  const eventChanged = data.published ? EVENT_FIELDS.filter((k) => data.draft[k] !== data.published![k]) : EVENT_FIELDS;
  const status = !data.published ? 'draft' : data.hasUnpublishedChanges ? 'changed' : 'published';
  const rules = form.form;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      {/* Status and actions */}
      <div className="card sticky top-[4.6rem] z-20 flex flex-wrap items-center gap-3 border-slate-200 bg-white/95 p-4 shadow-soft backdrop-blur lg:top-[5.1rem]">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="display text-xl leading-none">Landing page</span> <StatusPill status={status} />
            {unsaved && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">Not saved</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {data.publishedAt ? `Published ${formatDateTime(data.publishedAt)} by ${data.publishedByName}` : 'Never published'}
            {data.updatedAt && ` · Last saved ${formatDateTime(data.updatedAt)} by ${data.updatedByName}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/?preview=1"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            title={unsaved ? 'Save first: the preview shows the saved draft' : 'Open the preview in a new tab'}
          >
            <Eye className="h-4 w-4" aria-hidden /> Preview
          </a>
          {data.published && data.hasUnpublishedChanges && !unsaved && (
            <Button size="sm" variant="ghost" loading={busy === 'discard'} disabled={Boolean(busy)} onClick={() => setConfirm('discard')}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Discard draft
            </Button>
          )}
          <Button size="sm" variant="secondary" loading={busy === 'save'} disabled={Boolean(busy) || !unsaved} onClick={save}>
            <Save className="h-4 w-4" aria-hidden /> Save draft
          </Button>
          <Button
            size="sm"
            loading={busy === 'publish'}
            disabled={Boolean(busy) || unsaved || !data.hasUnpublishedChanges || data.version === 0}
            onClick={() => setConfirm('publish')}
            title={unsaved ? 'Save the draft first' : undefined}
          >
            <Send className="h-4 w-4" aria-hidden /> Publish
          </Button>
        </div>
        {stale && (
          <div className="w-full">
            <Alert tone="warning" title="Another admin changed this page" action={<Button size="sm" variant="secondary" onClick={load}>Reload</Button>}>
              Reload to see their version. Your unsaved changes will be lost; copy anything you need first.
            </Alert>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-5">
        <SectionCard id="pc-conference" title="Conference" description="Shown at the top of the website. Title, date, location and venue also appear in WhatsApp messages and on entry passes.">
          {input('presenter', 'Line above the title', { maxLength: 120 })}
          {input('title', 'Title', { maxLength: 160, hint: 'Put *stars* around a word to show it in the accent colour.' })}
          {area('intro', 'Introduction', { maxLength: 1500, rows: 3 })}
          <div className="grid gap-4 sm:grid-cols-2">
            {input('dateText', 'Date', { maxLength: 80, placeholder: 'e.g. 15 November 2026' })}
            {input('location', 'Location', { maxLength: 120 })}
          </div>
          {input('themeShort', 'Theme (short, in the details list)', { maxLength: 120 })}
        </SectionCard>

        <SectionCard id="pc-logo" title="Logo and poster">
          <ImageField label="Logo" value={form.logo} onChange={(v) => set('logo', v)} error={fields.logo} />
          <ImageField label="Poster" value={form.poster} onChange={(v) => set('poster', v)} error={fields.poster} />
          <div className="grid gap-4 sm:grid-cols-2">
            {input('posterCaption', 'Poster caption', { maxLength: 120 })}
            {input('posterTag', 'Poster tag', { maxLength: 60 })}
          </div>
        </SectionCard>

        <SectionCard id="pc-theme" title="Theme">
          {input('themeTitle', 'Theme heading', { maxLength: 200 })}
          {input('themeSubtitle', 'Theme subtitle', { maxLength: 200 })}
          {area('themeBody', 'Theme description', { maxLength: 5000, rows: 5, hint: 'Separate paragraphs with an empty line.' })}
        </SectionCard>

        <SectionCard id="pc-about" title="About">
          {input('aboutHeading', 'Heading', { maxLength: 160 })}
          {area('aboutBody', 'Text', { maxLength: 6000, rows: 6 })}
          <ImageField label="Image (optional)" value={form.aboutImage} onChange={(v) => set('aboutImage', v)} error={fields.aboutImage} />
        </SectionCard>

        <SectionCard id="pc-headings" title="Section headings">
          <div className="grid gap-4 sm:grid-cols-2">
            {input('updatesHeading', 'Announcements', { maxLength: 160 })}
            {input('programmeHeading', 'Programme', { maxLength: 160 })}
            {input('speakersHeading', 'Speakers', { maxLength: 160 })}
            {input('galleryHeading', 'Gallery', { maxLength: 160 })}
            {input('faqHeading', 'FAQ', { maxLength: 160 })}
            {input('regHeading', 'Registration', { maxLength: 200 })}
          </div>
          {area('programmeIntro', 'Programme introduction', { maxLength: 1500, rows: 2 })}
          {area('regNote', 'Note under the registration steps', { maxLength: 800, rows: 2 })}
        </SectionCard>

        <SectionCard id="pc-venue" title="Venue" description="Until a venue is filled in, the website says the full venue details will be announced.">
          {input('venue', 'Venue name', { maxLength: 160 })}
          {area('venueAddress', 'Address', { maxLength: 600, rows: 3 })}
          {input('mapUrl', 'Map link', { maxLength: 500, type: 'url', inputMode: 'url', placeholder: 'https://' })}
        </SectionCard>

        <SectionCard id="pc-contact" title="Contact" description="Each line appears only when filled in.">
          <div className="grid gap-4 sm:grid-cols-2">
            {input('phone', 'Phone', { maxLength: 40, inputMode: 'tel' })}
            {input('whatsapp', 'WhatsApp', { maxLength: 40, inputMode: 'tel' })}
            {input('email', 'Email', { maxLength: 200, type: 'email', inputMode: 'email' })}
            {input('facebook', 'Facebook link', { maxLength: 500, inputMode: 'url', placeholder: 'https://' })}
            {input('instagram', 'Instagram link', { maxLength: 500, inputMode: 'url', placeholder: 'https://' })}
            {input('youtube', 'YouTube link', { maxLength: 500, inputMode: 'url', placeholder: 'https://' })}
          </div>
        </SectionCard>

        <SectionCard id="pc-closing" title="Closing band and footer">
          {input('closingText', 'Closing line', { maxLength: 200 })}
          {input('footerText', 'Footer text', { maxLength: 200 })}
        </SectionCard>

        <SectionCard id="pc-sections" title="Sections shown" description="A switched-off section is hidden from visitors. Preview still shows it, outlined.">
          <div className="grid gap-2 sm:grid-cols-3">
            {SECTIONS.map(([k, label]) => (
              <Toggle key={k} label={label} checked={form.show[k]} onChange={(v) => set('show', { ...form.show, [k]: v })} />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="registration"
          title="Registration"
          description="Gender options and children limits are decisions for GIO Keralam. Until they are filled in, the form does not ask these questions."
        >
          <Toggle
            label="Registration open"
            description="Turn off to close the public form. REGISTRATION_OPEN=false on the server always closes it."
            checked={form.registrationOpen}
            onChange={(v) => set('registrationOpen', v)}
          />
          <TextArea
            label="Gender options"
            value={genderText}
            onChange={(v) => {
              setGenderText(v);
              setFields((e) => ({ ...e, 'form.genderOptions': '' }));
            }}
            rows={3}
            maxLength={300}
            error={fields['form.genderOptions']}
            hint="One option per line. Leave empty to leave the question out."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput
              label="Maximum children"
              inputMode="numeric"
              value={rules.childrenMax === null ? '' : String(rules.childrenMax)}
              onChange={(v) => setRule('childrenMax', v)}
              error={fields['form.childrenMax']}
              maxLength={2}
            />
            <TextInput
              label="Youngest child age"
              inputMode="numeric"
              value={rules.childAgeMin === null ? '' : String(rules.childAgeMin)}
              onChange={(v) => setRule('childAgeMin', v)}
              error={fields['form.childAgeMin']}
              maxLength={2}
            />
            <TextInput
              label="Oldest child age"
              inputMode="numeric"
              value={rules.childAgeMax === null ? '' : String(rules.childAgeMax)}
              onChange={(v) => setRule('childAgeMax', v)}
              error={fields['form.childAgeMax']}
              maxLength={2}
            />
          </div>
          <p className={cx('rounded-xl px-4 py-3 text-sm', rules.childrenMax ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-100' : 'bg-slate-100/70 text-slate-600')}>
            {rules.childrenMax
              ? `The form asks for up to ${rules.childrenMax} accompanying children and each child's age. The pass and confirmation show only the number of children.`
              : 'Children are not asked for. Fill in all three values to add the question.'}
          </p>
        </SectionCard>
      </div>

      <Dialog
        open={confirm === 'publish'}
        title="Publish the landing page?"
        icon={
          eventChanged.length > 0 ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <TriangleAlert className="h-5 w-5" aria-hidden />
            </span>
          ) : undefined
        }
        onClose={() => setConfirm('')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm('')}>
              Cancel
            </Button>
            <Button onClick={publish} data-autofocus>
              Publish
            </Button>
          </>
        }
      >
        <p>Visitors see the new version at their next page load.</p>
        {eventChanged.length > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-900">
            The conference title, date, location or venue changes. New WhatsApp messages and every entry pass image drawn from now on will show the new details.
            {data.passesIssued ? ` ${data.passesIssued} pass${data.passesIssued === 1 ? ' has' : 'es have'} already been issued; images already delivered on WhatsApp keep the old details unless the pass is resent.` : ''}
            {' '}Holder details on passes do not change.
          </p>
        )}
      </Dialog>

      <Dialog
        open={confirm === 'discard'}
        title="Discard the draft?"
        description="The draft goes back to the published version. This cannot be undone."
        onClose={() => setConfirm('')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm('')} data-autofocus>
              Keep draft
            </Button>
            <Button variant="danger" onClick={discard}>
              Discard
            </Button>
          </>
        }
      />
    </main>
  );
}
