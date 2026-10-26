// Confirm / resend / generate actions and the entry pass viewer, shared by
// the dashboard list and the registration detail page.
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, BadgeCheck, Download, ImageOff, Loader2, RefreshCw, Send, Ticket } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { MessageResult, RegistrationDetail, RegistrationItem } from '../lib/types';
import { TEMPLATE_LABEL } from '../lib/format';
import { Button, Dialog, cx, useToast } from './ui';

export type ActionKind = 'confirm' | 'resend' | 'generate';

type Target = Pick<RegistrationItem, 'id' | 'name' | 'regNo' | 'mobileDisplay' | 'messagesTo' | 'passId' | 'passStatus'>;

const ACTIONS: Record<
  ActionKind,
  { title: string; confirmLabel: string; path: (id: string) => string; icon: ReactNode; body: (r: Target) => ReactNode }
> = {
  confirm: {
    title: 'Confirm this registration?',
    confirmLabel: 'Yes, confirm registration',
    path: (id) => `/api/admin/registrations/${id}/actions/confirm`,
    icon: (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
        <BadgeCheck className="h-5 w-5" aria-hidden />
      </span>
    ),
    body: (r) => (
      <>
        <Summary r={r} />
        <p className="mt-4 font-medium text-slate-700">This will:</p>
        <ul className="mt-2 space-y-1.5">
          {['Mark the registration as Confirmed', 'Generate a unique entry pass', `Send the confirmation and the entry pass to ${r.messagesTo} on WhatsApp`].map(
            (t) => (
              <li key={t} className="flex gap-2">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden /> {t}
              </li>
            )
          )}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          A registration can be confirmed only once. If WhatsApp sending fails, the confirmation and the pass are kept and you can retry.
        </p>
      </>
    ),
  },
  resend: {
    title: 'Send the entry pass again?',
    confirmLabel: 'Resend pass',
    path: (id) => `/api/admin/registrations/${id}/pass/resend`,
    icon: (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
        <Send className="h-5 w-5" aria-hidden />
      </span>
    ),
    body: (r) => (
      <>
        <Summary r={r} />
        <p className="mt-4">
          The same entry pass ({r.passId}) is sent again to {r.messagesTo} on WhatsApp. No new pass is created.
          {r.passStatus === 'sent' && ' Use this only if the registrant did not receive it.'}
        </p>
      </>
    ),
  },
  generate: {
    title: 'Generate the entry pass?',
    confirmLabel: 'Generate and send',
    path: (id) => `/api/admin/registrations/${id}/pass/generate`,
    icon: (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
        <Ticket className="h-5 w-5" aria-hidden />
      </span>
    ),
    body: (r) => (
      <>
        <Summary r={r} />
        <p className="mt-4">Generating the pass failed earlier. A pass is generated now and sent to {r.messagesTo} on WhatsApp.</p>
      </>
    ),
  },
};

function Summary({ r }: { r: Target }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="font-serif text-xl leading-tight text-slate-900">{r.name}</p>
      <p className="text-[13px] text-slate-500">
        {r.regNo} · {r.mobileDisplay}
        {r.messagesTo !== r.mobileDisplay && ` · WhatsApp ${r.messagesTo}`}
      </p>
    </div>
  );
}

const SUCCESS: Record<ActionKind, string> = {
  confirm: 'Registration confirmed and entry pass generated',
  resend: 'Entry pass sent again',
  generate: 'Entry pass generated',
};

/** Shows toasts for an action result, including each failed WhatsApp message. */
export function useReportResult() {
  const toast = useToast();
  return useCallback(
    (res: RegistrationDetail, success: string) => {
      const messages: MessageResult[] = res.messages ?? [];
      const failed = messages.filter((m) => !m.ok);
      const accepted = messages.filter((m) => m.ok && !m.duplicate).length;
      if (res.passError) toast('error', res.passError);
      for (const m of failed) {
        toast('error', `WhatsApp "${TEMPLATE_LABEL[m.template ?? ''] ?? 'message'}" failed: ${m.error}. You can retry it.`);
      }
      if (!res.passError && !failed.length) {
        toast('success', accepted ? `${success}. WhatsApp message${accepted > 1 ? 's' : ''} accepted by DXing.` : `${success}.`);
      } else if (!res.passError && failed.length) {
        toast('info', `${success}, but not every WhatsApp message went out.`);
      }
    },
    [toast]
  );
}

/**
 * Returns `ask(kind, registration)` and the dialog element to render. The
 * server refuses repeats (e.g. a second confirm) whatever the client does;
 * the busy state here just stops a double click from sending two requests.
 */
export function useRegistrationActions(onDone: (res: RegistrationDetail) => void) {
  const toast = useToast();
  const report = useReportResult();
  const [request, setRequest] = useState<{ kind: ActionKind; target: Target } | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((kind: ActionKind, target: Target) => setRequest({ kind, target }), []);

  async function run() {
    if (!request || busy) return;
    const { kind, target } = request;
    setBusy(true);
    try {
      const res = await api<RegistrationDetail>(ACTIONS[kind].path(target.id), { method: 'POST', body: {} });
      report(res, SUCCESS[kind]);
      onDone(res);
      setRequest(null);
    } catch (err) {
      toast('error', errorMessage(err));
      setRequest(null);
    } finally {
      setBusy(false);
    }
  }

  const def = request ? ACTIONS[request.kind] : null;
  const dialog = (
    <Dialog
      open={Boolean(request)}
      title={def?.title ?? ''}
      icon={def?.icon}
      onClose={() => !busy && setRequest(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setRequest(null)} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={run} data-autofocus>
            {busy ? 'Working…' : def?.confirmLabel}
          </Button>
        </>
      }
    >
      {request && def?.body(request.target)}
    </Dialog>
  );

  return { ask, busy, dialog };
}

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
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100" style={{ aspectRatio: '1080 / 1660' }}>
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

/** Modal with the pass image, download and resend. */
export function PassViewer({
  target,
  canSend,
  onClose,
  onResend,
}: {
  target: Target | null;
  canSend: boolean;
  onClose: () => void;
  onResend: (t: Target) => void;
}) {
  return (
    <Dialog
      open={Boolean(target)}
      size="lg"
      title="Entry pass"
      description={target ? `${target.name} · ${target.passId}` : undefined}
      onClose={onClose}
      footer={
        target && (
          <>
            {canSend && (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  onResend(target);
                }}
              >
                <Send className="h-4 w-4" aria-hidden /> Resend
              </Button>
            )}
            <DownloadPassLink id={target.id} passId={target.passId} className="btn-primary min-h-[44px] rounded-full px-5 text-sm" />
          </>
        )
      }
    >
      {target && (
        <div className="mx-auto max-w-[19rem]">
          {target.passStatus === 'send_failed' && (
            <p className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-[13px] text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> The last WhatsApp send failed. The pass is saved; resend it when ready.
            </p>
          )}
          <PassImage id={target.id} passId={target.passId} name={target.name} />
        </div>
      )}
    </Dialog>
  );
}
