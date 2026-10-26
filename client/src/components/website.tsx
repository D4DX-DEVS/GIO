// Shared pieces of the admin "Website" section: status pills, simple form
// controls, image upload checks and the image picker.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ImageOff, ImagePlus, Upload, X } from 'lucide-react';
import { api, errorMessage, uploadFile } from '../lib/api';
import type { ItemStatus, LibraryImage } from '../lib/types';
import { Alert, Button, Dialog, Field, Skeleton, cx, useToast } from './ui';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const STATUS_STYLE: Record<ItemStatus, [string, string]> = {
  published: ['Published', 'bg-emerald-50 text-emerald-800 ring-emerald-200/80'],
  draft: ['Draft', 'bg-amber-50 text-amber-800 ring-amber-200/80'],
  changed: ['Unpublished changes', 'bg-brand-50 text-brand-700 ring-brand-200/80'],
};

export function StatusPill({ status }: { status: ItemStatus }) {
  const [label, cls] = STATUS_STYLE[status];
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', cls)}>{label}</span>;
}

type Common = { label: string; error?: string; hint?: ReactNode; className?: string };

export function TextInput({
  label,
  error,
  hint,
  className,
  value,
  onChange,
  maxLength = 200,
  placeholder,
  type = 'text',
  inputMode,
}: Common & {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'email' | 'url' | 'tel';
}) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(p) => (
        <input
          {...p}
          type={type}
          inputMode={inputMode}
          className={cx('input', error && 'input-error')}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  error,
  hint,
  className,
  value,
  onChange,
  maxLength = 3000,
  rows = 4,
}: Common & { value: string; onChange: (v: string) => void; maxLength?: number; rows?: number }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(p) => (
        <textarea {...p} rows={rows} className={cx('input min-h-[6rem] resize-y leading-relaxed', error && 'input-error')} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function Toggle({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition',
        checked ? 'border-brand-200 bg-brand-50/50 hover:border-brand-300' : 'border-slate-200 bg-white hover:border-slate-300'
      )}
    >
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

/** Same first checks the server makes, so mistakes are caught before uploading. */
export function checkImageFile(file: File): string | null {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return 'Only JPEG and PNG images can be uploaded.';
  if (file.size > MAX_UPLOAD_BYTES) return 'The image is larger than 5 MB.';
  return null;
}

export function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

/** Upload dialog: preview, alt text (required) and caption. */
export function UploadDialog({ file, onClose, onUploaded }: { file: File | null; onClose: () => void; onUploaded: (img: LibraryImage) => void }) {
  const preview = useObjectUrl(file);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    setAlt('');
    setCaption('');
    setError('');
    setFields({});
  }, [file]);

  async function submit() {
    if (!file) return;
    if (!alt.trim()) {
      setFields({ alt: 'Describe the image for people who cannot see it' });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const q = new URLSearchParams({ alt: alt.trim(), caption: caption.trim() });
      const img = await uploadFile<LibraryImage>(`/api/admin/website/assets?${q}`, file, file.name);
      onUploaded(img);
    } catch (err) {
      setError(errorMessage(err));
      setFields((err as { fields?: Record<string, string> }).fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(file)}
      size="lg"
      title="Upload image"
      description={file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : undefined}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit}>
            <Upload className="h-4 w-4" aria-hidden /> Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {preview && <img src={preview} alt="" className="mx-auto max-h-64 rounded-lg border border-slate-200 object-contain" />}
        <TextInput label="Alternative text" value={alt} onChange={setAlt} maxLength={300} error={fields.alt} hint="Read aloud by screen readers. Describe what the image shows." />
        <TextInput label="Caption (optional)" value={caption} onChange={setCaption} maxLength={300} error={fields.caption} />
        <p className="text-xs text-slate-500">
          The server removes hidden data such as the location in phone photos and reduces large images to 1600 pixels. Upload only images GIO Keralam has the right to publish.
        </p>
        {error && <Alert>{error}</Alert>}
      </div>
    </Dialog>
  );
}

export function useImageLibrary() {
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api<{ assets: LibraryImage[] }>('/api/admin/website/assets')
      .then((r) => setImages(r.assets))
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);
  return { images, error, load, setImages };
}

/** A field holding an image id, with a picker that can also upload. */
export function ImageField({ label, value, onChange, error, hint }: { label: string; value: string; onChange: (id: string) => void; error?: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  const { images, load } = useImageLibrary();
  const current = images?.find((i) => i.id === value);

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <div className={cx('flex items-center gap-3 rounded-xl border bg-white p-2.5', error ? 'border-red-300' : 'border-slate-200')}>
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
          {value && !images ? (
            <Skeleton className="h-16 w-16" />
          ) : current ? (
            <img src={current.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageOff className="h-6 w-6 text-slate-300" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="block truncate font-medium text-slate-800">{current ? current.alt : value ? 'Image not found' : 'No image'}</span>
          {current && (
            <span className="block text-xs text-slate-500">
              {current.width}×{current.height}
            </span>
          )}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {value ? 'Change' : 'Choose'}
        </Button>
        {value && (
          <Button size="icon" variant="ghost" onClick={() => onChange('')} aria-label={`Remove ${label.toLowerCase()}`}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {error ? <p className="mt-1.5 text-[13px] font-medium text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-[13px] text-slate-500">{hint}</p> : null}
      <ImagePicker
        open={open}
        images={images}
        selected={value}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
        onUploaded={load}
      />
    </div>
  );
}

function ImagePicker({
  open,
  images,
  selected,
  onClose,
  onPick,
  onUploaded,
}: {
  open: boolean;
  images: LibraryImage[] | null;
  selected: string;
  onClose: () => void;
  onPick: (id: string) => void;
  onUploaded: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  return (
    <>
      <Dialog
        open={open && !file}
        size="lg"
        title="Choose an image"
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" aria-hidden /> Upload new
            </Button>
          </>
        }
      >
        {!images ? (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No images yet. Upload one.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((img) => (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => onPick(img.id)}
                  className={cx(
                    'block w-full overflow-hidden rounded-lg border-2 bg-slate-50 text-left transition hover:border-brand-300',
                    img.id === selected ? 'border-brand-600' : 'border-transparent'
                  )}
                >
                  <img src={img.url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                  <span className="block truncate px-2 py-1.5 text-xs text-slate-600">{img.alt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (!f) return;
          const problem = checkImageFile(f);
          if (problem) toast('error', problem);
          else setFile(f);
        }}
      />
      <UploadDialog
        file={file}
        onClose={() => setFile(null)}
        onUploaded={(img) => {
          setFile(null);
          onUploaded();
          toast('success', 'Image uploaded');
          onPick(img.id);
        }}
      />
    </>
  );
}

export function SectionCard({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="card scroll-mt-44 p-5 sm:p-7">
      <h2 className="display text-[26px] leading-tight">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>}
      <div className="mt-5 space-y-4 border-t border-slate-200/70 pt-5">{children}</div>
    </section>
  );
}
