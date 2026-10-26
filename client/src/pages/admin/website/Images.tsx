// Website > Images: the image library. Upload, edit alternative text and
// captions, replace the file everywhere it is used, and delete images that
// are no longer used.
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, Images as ImagesIcon, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { api, errorMessage, uploadFile } from '../../../lib/api';
import type { LibraryImage } from '../../../lib/types';
import { formatDateTime } from '../../../lib/format';
import { Alert, Button, Dialog, EmptyState, Skeleton, useToast } from '../../../components/ui';
import { TextInput, UploadDialog, checkImageFile, useImageLibrary, useObjectUrl } from '../../../components/website';

export default function Images() {
  const toast = useToast();
  const { images, error, load, setImages } = useImageLibrary();
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<LibraryImage | null>(null);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState<{ image: LibraryImage; file: File | null } | null>(null);
  const [deleting, setDeleting] = useState<LibraryImage | null>(null);
  const [busy, setBusy] = useState(false);
  const replacePreview = useObjectUrl(replacing?.file ?? null);

  const update = (img: LibraryImage) => setImages((all) => (all ? all.map((i) => (i.id === img.id ? img : i)) : all));

  function pick(e: ChangeEvent<HTMLInputElement>, then: (f: File) => void) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    const problem = checkImageFile(f);
    if (problem) toast('error', problem);
    else then(f);
  }

  async function saveMeta() {
    if (!editing) return;
    setSaving(true);
    setFields({});
    try {
      update(await api<LibraryImage>(`/api/admin/website/assets/${editing.id}`, { method: 'PUT', body: { alt, caption } }));
      setEditing(null);
      toast('success', 'Saved');
    } catch (err) {
      setFields((err as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function replace() {
    if (!replacing?.file) return;
    setBusy(true);
    try {
      update(await uploadFile<LibraryImage>(`/api/admin/website/assets/${replacing.image.id}/replace`, replacing.file, replacing.file.name));
      setReplacing(null);
      toast('success', 'Image replaced everywhere it is used.');
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/admin/website/assets/${deleting.id}`, { method: 'DELETE' });
      setImages((all) => (all ? all.filter((i) => i.id !== deleting.id) : all));
      toast('success', 'Image deleted');
      setDeleting(null);
    } catch (err) {
      toast('error', errorMessage(err));
      setDeleting(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <p className="kicker">Image library</p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            JPEG or PNG, up to 5 MB, at least 200 pixels on each side. Use an image as the logo, poster or About image in Page content, as a speaker photo, or in the
            gallery.
          </p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => uploadRef.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden /> Upload image
        </Button>
        <input ref={uploadRef} type="file" accept="image/jpeg,image/png" className="sr-only" tabIndex={-1} onChange={(e) => pick(e, setNewFile)} />
        <input
          ref={replaceRef}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => pick(e, (f) => setReplacing((r) => (r ? { ...r, file: f } : r)))}
        />
      </div>

      <div className="mt-5">
        {error ? (
          <Alert action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{error}</Alert>
        ) : !images ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="card">
            <EmptyState icon={ImagesIcon} title="No images yet">
              Upload the conference poster, banners and other images.
            </EmptyState>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {images.map((img) => (
              <li key={img.id} className="card flex min-w-0 flex-col overflow-hidden transition hover:shadow-soft">
                <a href={img.url} target="_blank" rel="noreferrer" className="block border-b border-slate-200/70 bg-slate-100/70 p-2">
                  <img src={img.url} alt={img.alt} className="aspect-[4/3] w-full object-contain" loading="lazy" />
                </a>
                <div className="flex flex-1 flex-col p-3.5">
                  <p className="line-clamp-2 break-words text-sm font-semibold text-slate-900">{img.alt}</p>
                  {img.caption && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{img.caption}</p>}
                  <p className="mt-2 text-[11px] text-slate-500">
                    {img.width}×{img.height} · {(img.size / 1024).toFixed(0)} KB · {formatDateTime(img.replacedAt ?? img.createdAt)}
                  </p>
                  <p className="mt-2">
                    <span
                      className={
                        img.usedIn.length
                          ? 'inline-flex max-w-full rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-100'
                          : 'inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500'
                      }
                    >
                      <span className="truncate">{img.usedIn.length ? `In use: ${img.usedIn.join(', ')}` : 'Not used'}</span>
                    </span>
                  </p>
                  <div className="mt-auto flex gap-1.5 pt-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(img);
                        setAlt(img.alt);
                        setCaption(img.caption);
                        setFields({});
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setReplacing({ image: img, file: null })}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Replace
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => setDeleting(img)}
                      aria-label={`Delete ${img.alt}`}
                      title={img.usedIn.length ? 'In use: remove it from those places first' : 'Delete'}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <UploadDialog
        file={newFile}
        onClose={() => setNewFile(null)}
        onUploaded={(img) => {
          setNewFile(null);
          setImages((all) => [img, ...(all ?? [])]);
          toast('success', 'Image uploaded');
        }}
      />

      <Dialog
        open={Boolean(editing)}
        title="Edit image details"
        onClose={() => !saving && setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={saveMeta}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <img src={editing.url} alt="" className="mx-auto max-h-48 rounded-lg border border-slate-200 object-contain" />
            <TextInput label="Alternative text" value={alt} onChange={setAlt} maxLength={300} error={fields.alt} />
            <TextInput label="Caption" value={caption} onChange={setCaption} maxLength={300} error={fields.caption} />
            <p className="text-xs text-slate-500">Changes apply to the website immediately wherever this image is published.</p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(replacing)}
        size="lg"
        title="Replace image"
        description="The new file is used everywhere this image appears, including on the published website."
        onClose={() => !busy && setReplacing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReplacing(null)} disabled={busy}>
              Cancel
            </Button>
            {replacing?.file ? (
              <Button loading={busy} onClick={replace}>
                Replace
              </Button>
            ) : (
              <Button onClick={() => replaceRef.current?.click()}>Choose file</Button>
            )}
          </>
        }
      >
        {replacing && (
          <div className="grid grid-cols-2 gap-3 text-center text-xs text-slate-500">
            <figure>
              <img src={replacing.image.url} alt="" className="mx-auto max-h-48 rounded-lg border border-slate-200 object-contain" />
              <figcaption className="mt-1">Current</figcaption>
            </figure>
            <figure>
              {replacePreview ? (
                <img src={replacePreview} alt="" className="mx-auto max-h-48 rounded-lg border border-slate-200 object-contain" />
              ) : (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-300">No file chosen</div>
              )}
              <figcaption className="mt-1">New</figcaption>
            </figure>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        title="Delete this image?"
        description={
          deleting?.usedIn.length
            ? `It is still used (${deleting.usedIn.join(', ')}). Remove it from those places first; the server will refuse otherwise.`
            : 'The image is removed from storage. This cannot be undone.'
        }
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} disabled={Boolean(deleting?.usedIn.length)} onClick={remove}>
              Delete
            </Button>
          </>
        }
      />
    </main>
  );
}
