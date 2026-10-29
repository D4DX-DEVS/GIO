// "Generate pass" (for a registration without one) and the entry pass
// viewer, shared by the dashboard list and the registration detail page.
// Passes are generated automatically at submission; admins only list them.
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, ImageOff, Loader2, RefreshCw, Ticket } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { RegistrationDetail, RegistrationItem } from '../lib/types';
import { Button, Dialog, cx, useToast } from './ui';

type Target = Pick<RegistrationItem, 'id' | 'name' | 'regNo' | 'mobileDisplay' | 'passId' | 'status'>;

function Summary({ r }: { r: Target }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="font-serif text-xl leading-tight text-slate-900">{r.name}</p>
      <p className="text-[13px] text-slate-500">
        {r.regNo} · {r.mobileDisplay}
      </p>
    </div>
  );
}

/**
 * Returns `ask(registration)` and the dialog element to render. The server
 * never creates a second pass whatever the client does; the busy state here
 * just stops a double click from sending two requests.
 */
export function useGeneratePass(onDone: (res: RegistrationDetail) => void) {
  const toast = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((t: Target) => setTarget(t), []);

  async function run() {
    if (!target || busy) return;
    setBusy(true);
    try {
      const res = await api<RegistrationDetail>(`/api/admin/registrations/${target.id}/pass/generate`, { method: 'POST', body: {} });
      toast('success', 'Entry pass generated.');
      onDone(res);
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setTarget(null);
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog
      open={Boolean(target)}
      title="Generate the entry pass?"
      icon={
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
          <Ticket className="h-5 w-5" aria-hidden />
        </span>
      }
      onClose={() => !busy && setTarget(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setTarget(null)} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={run} data-autofocus>
            {busy ? 'Working…' : 'Generate pass'}
          </Button>
        </>
      }
    >
      {target && (
        <>
          <Summary r={target} />
          <p className="mt-4">
            {target.status === 'submitted'
              ? 'This registration was made before passes were generated automatically. It is confirmed and its entry pass is generated now.'
              : 'Generating the pass failed when this registration was submitted. A pass is generated now.'}
          </p>
        </>
      )}
    </Dialog>
  );

  return { ask, busy, dialog };
}

// Viewing redirects to the image on the Spaces CDN; download=1 sends it from this origin.
export const passImageUrl = (id: string, passId: string | null, download = false) =>
  `/api/admin/registrations/${id}/pass.png?v=${encodeURIComponent(passId ?? '')}${download ? '&download=1' : ''}`;

export function DownloadPassLink({ id, passId, className, children }: { id: string; passId: string | null; className?: string; children?: ReactNode }) {
  return (
    <a
      href={passImageUrl(id, passId, true)}
      download={`entry-pass-${passId}.png`}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20',
        className
      )}
    >
      {children ?? (
        <>
          <Download className="h-4 w-4" aria-hidden /> Download
        </>
      )}
    </a>
  );
}

export function PassImage({ id, passId, name, refreshKey = 0 }: { id: string; passId: string | null; name: string; refreshKey?: number }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const src = `${passImageUrl(id, passId)}&r=${refreshKey}-${attempt}`;
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100" style={{ aspectRatio: '1080 / 1440' }}>
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-brand-600" aria-hidden /> Loading pass…
        </div>
      )}
      {state === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-slate-500">
          <ImageOff className="h-7 w-7 text-slate-400" aria-hidden />
          The pass image could not be loaded.
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setState('loading');
              setAttempt((a) => a + 1);
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Try again
          </Button>
        </div>
      ) : (
        <img
          key={src}
          src={src}
          alt={`Entry pass for ${name}`}
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
          className={cx('h-full w-full object-contain transition-opacity duration-300', state === 'ready' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  );
}

/** Modal with the pass image and download. */
export function PassViewer({ target, onClose }: { target: Target | null; onClose: () => void }) {
  return (
    <Dialog
      open={Boolean(target)}
      size="lg"
      title="Entry pass"
      description={target ? `${target.name} · ${target.passId}` : undefined}
      onClose={onClose}
      footer={target && <DownloadPassLink id={target.id} passId={target.passId} className="btn-primary min-h-[44px] rounded-full px-5 text-sm" />}
    >
      {target && (
        <div className="mx-auto max-w-[19rem]">
          <PassImage id={target.id} passId={target.passId} name={target.name} />
        </div>
      )}
    </Dialog>
  );
}
