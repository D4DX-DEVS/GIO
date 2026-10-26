import { useCallback, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Expand,
  FileCheck2,
  History,
  MessageCircle,
  RefreshCw,
  Send,
  Ticket,
  XCircle,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { RegistrationDetail as Detail } from '../../lib/types';
import { PASS_LABEL, STATUS_LABEL, TEMPLATE_LABEL, formatDateTime } from '../../lib/format';
import { Alert, Avatar, Button, PassBadge, Skeleton, StatusBadge, cx, useToast } from '../../components/ui';
import { DownloadPassLink, PassImage, PassViewer, useRegistrationActions, useReportResult } from '../../components/RegistrationActions';
import type { ActionKind } from '../../components/RegistrationActions';
import { useLayout } from './AdminLayout';

const MSG_STATUS = {
  accepted: { label: 'Accepted by DXing', cls: 'text-emerald-700 bg-emerald-50', Icon: CheckCircle2 },
  failed: { label: 'Failed', cls: 'text-red-700 bg-red-50', Icon: XCircle },
  sending: { label: 'Sending', cls: 'text-amber-700 bg-amber-50', Icon: Clock },
} as const;

function availableActions(d: Detail): ActionKind[] {
  const { status } = d.registration;
  const out: ActionKind[] = [];
  if (status === 'submitted' && d.permissions.approve) out.push('confirm');
  if (status === 'confirmed' && d.permissions.send) out.push(d.pass?.status === 'active' ? 'resend' : 'generate');
  return out;
}

const ACTION_BUTTON: Record<ActionKind, { label: string; icon: ComponentType<{ className?: string }> }> = {
  confirm: { label: 'Confirm Registration', icon: BadgeCheck },
  resend: { label: 'Resend entry pass', icon: Send },
  generate: { label: 'Generate entry pass', icon: Ticket },
};

function Card({ title, icon: Icon, children, aside }: { title: string; icon: ComponentType<{ className?: string }>; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <Icon className="h-[18px] w-[18px] text-slate-400" /> {title}
        </h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function RegistrationDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const report = useReportResult();
  const { refreshStats } = useLayout();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [imgKey, setImgKey] = useState(0);
  const [viewing, setViewing] = useState(false);

  const load = useCallback(() => {
    setError('');
    api<Detail>(`/api/admin/registrations/${id}`)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(load, [load]);

  const { ask, dialog } = useRegistrationActions((res) => {
    setDetail(res);
    setImgKey((k) => k + 1);
    refreshStats();
  });

  async function retry(nid: string) {
    if (retrying) return;
    setRetrying(nid);
    try {
      const res = await api<Detail>(`/api/admin/registrations/${id}/notifications/${nid}/retry`, { method: 'POST' });
      setDetail(res);
      report(res, 'Message sent again');
      refreshStats();
    } catch (err) {
      toast('error', errorMessage(err));
      load();
    } finally {
      setRetrying(null);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <BackLink />
        <div className="mt-4">
          <Alert
            title="This registration could not be loaded"
            action={
              <Button size="sm" variant="secondary" className="w-full" onClick={load}>
                Try again
              </Button>
            }
          >
            {error}
          </Alert>
        </div>
      </main>
    );
  }
  if (!detail) return <DetailSkeleton />;

  const r = detail.registration;
  const actions = availableActions(detail);
  const hasPass = detail.pass?.status === 'active';

  const steps = [
    { label: 'Submitted', at: r.createdAt, done: true, failed: false },
    { label: 'Confirmed', at: r.confirmedAt, done: r.status === 'confirmed', failed: false },
    { label: 'Pass generated', at: r.passGeneratedAt, done: r.status === 'confirmed' && r.passStatus !== 'not_generated', failed: false },
    {
      label: r.passStatus === 'send_failed' ? 'Pass send failed' : 'Pass sent',
      at: r.passStatus === 'send_failed' ? null : r.passSentAt,
      done: r.passStatus === 'sent',
      failed: r.passStatus === 'send_failed',
    },
  ];

  const actionButtons = (full: boolean) =>
    actions.map((a) => {
      const def = ACTION_BUTTON[a];
      const primary = a === 'confirm' || a === 'generate' || r.passStatus === 'send_failed';
      return (
        <Button key={a} variant={primary ? 'primary' : 'secondary'} onClick={() => ask(a, r)} className={full ? 'flex-1' : ''}>
          <def.icon className="h-4 w-4" aria-hidden />
          {a === 'resend' && r.passStatus === 'send_failed' ? 'Retry sending pass' : def.label}
        </Button>
      );
    });

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 md:pb-16 lg:px-8 lg:pt-7">
      <BackLink />

      {/* Header */}
      <div className="card mt-4 animate-fade-up p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar name={r.name} className="h-14 w-14 text-lg" />
            <div className="min-w-0">
              <h1 className="break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{r.name}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                <span className="font-mono font-medium text-slate-700">{r.regNo}</span> · Registered {formatDateTime(r.createdAt)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge status={r.status} />
                <PassBadge status={r.passStatus} />
              </div>
            </div>
          </div>
          {actions.length > 0 && <div className="hidden gap-2 md:flex">{actionButtons(false)}</div>}
        </div>

        {/* Workflow progress */}
        <ol className="mt-6 grid grid-cols-4 gap-2" aria-label="Workflow progress">
          {steps.map((s, i) => (
            <li key={s.label} className="min-w-0">
              <span
                className={cx(
                  'block h-1.5 rounded-full transition-colors duration-500',
                  s.failed ? 'bg-red-400' : s.done ? 'bg-brand-500' : 'bg-slate-200'
                )}
              />
              <span className="mt-2 flex items-center gap-1.5">
                <span
                  className={cx(
                    'hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold sm:flex',
                    s.failed ? 'bg-red-100 text-red-700' : s.done ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'
                  )}
                >
                  {s.failed ? '!' : i + 1}
                </span>
                <span className={cx('truncate text-[11px] font-semibold sm:text-xs', s.failed ? 'text-red-700' : s.done ? 'text-slate-900' : 'text-slate-400')}>
                  {s.label}
                </span>
              </span>
              <span className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">{s.done && s.at ? formatDateTime(s.at) : ' '}</span>
            </li>
          ))}
        </ol>

        {r.status === 'submitted' && (
          <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Awaiting confirmation. {detail.permissions.approve ? 'Review the details, then confirm the registration.' : 'An admin needs to confirm this registration.'}
          </p>
        )}
        {r.passStatus === 'send_failed' && (
          <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            The entry pass was generated and saved, but WhatsApp sending failed. See the messages below for the reason, then retry.
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <Card title="Registration details" icon={FileCheck2}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {[
                ['Name', r.name],
                ['Age', String(r.age)],
                ['Mobile', r.mobileDisplay],
                ['Email', r.email],
                ['District', r.district],
                ['Area', r.area],
                ['Unit', r.unit],
                ['Registration no.', r.regNo],
                ['Status', STATUS_LABEL[r.status] ?? r.status],
                ['Confirmed', r.confirmedAt ? `${formatDateTime(r.confirmedAt)}${r.confirmedByName ? ` by ${r.confirmedByName}` : ''}` : 'Not yet'],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="label-caps">{k}</dt>
                  <dd className="mt-0.5 break-words text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="WhatsApp messages" icon={MessageCircle}>
            {detail.notifications.length === 0 ? (
              <p className="text-sm text-slate-500">No messages yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {detail.notifications.map((n) => {
                  const st = MSG_STATUS[n.status];
                  return (
                    <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{TEMPLATE_LABEL[n.template] ?? n.template}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', st.cls)}>
                              <st.Icon className="h-3.5 w-3.5" aria-hidden /> {st.label}
                            </span>
                            {formatDateTime(n.acceptedAt ?? n.updatedAt)} · {n.attempts} attempt{n.attempts === 1 ? '' : 's'} · by {n.triggeredByName}
                          </p>
                        </div>
                        {n.status === 'failed' && detail.permissions.send && (
                          <Button size="sm" variant="secondary" loading={retrying === n.id} disabled={Boolean(retrying)} onClick={() => retry(n.id)}>
                            <RefreshCw className="h-4 w-4" aria-hidden /> Retry
                          </Button>
                        )}
                      </div>
                      {n.lastError && n.status === 'failed' && <p className="mt-2 rounded-lg bg-red-50 p-2.5 text-[13px] text-red-800">{n.lastError}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              “Accepted by DXing” means DXing accepted the request. DXing does not report whether the message reached the phone.
            </p>
          </Card>

          <Card title="History" icon={History}>
            <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
              {[...r.statusHistory].reverse().map((h, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[27px] top-0.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
                  <p className="font-medium text-slate-900">{STATUS_LABEL[h.to] ?? h.to}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(h.at)} · {h.byName}
                  </p>
                  {h.note && <p className="mt-1 text-slate-600">“{h.note}”</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card
            title="Entry pass"
            icon={Ticket}
            aside={detail.pass && <span className="font-mono text-xs font-semibold text-slate-600">{detail.pass.passId}</span>}
          >
            {hasPass && detail.pass ? (
              <>
                <button type="button" onClick={() => setViewing(true)} className="group relative block w-full" aria-label="View entry pass full size">
                  <PassImage id={r.id} passId={detail.pass.passId} name={r.name} refreshKey={imgKey} />
                  <span className="absolute right-2 top-2 rounded-lg bg-white/90 p-1.5 text-slate-600 opacity-0 shadow transition group-hover:opacity-100">
                    <Expand className="h-4 w-4" aria-hidden />
                  </span>
                </button>
                <dl className="mt-4 space-y-1.5 text-[13px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Status</dt>
                    <dd className="font-medium text-slate-800">{PASS_LABEL[r.passStatus]}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Generated</dt>
                    <dd className="text-slate-800">{formatDateTime(r.passGeneratedAt ?? detail.pass.issuedAt)}</dd>
                  </div>
                  {r.passSentAt && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Last sent</dt>
                      <dd className="text-slate-800">{formatDateTime(r.passSentAt)}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setViewing(true)}>
                    <Expand className="h-4 w-4" aria-hidden /> View
                  </Button>
                  <DownloadPassLink id={r.id} passId={detail.pass.passId} className="min-h-[44px] rounded-xl border border-slate-200 bg-white text-sm text-slate-700 shadow-sm hover:bg-slate-50" />
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <Ticket className="mx-auto h-7 w-7 text-slate-300" aria-hidden />
                <p className="mt-2 text-sm text-slate-500">
                  {r.status === 'confirmed'
                    ? 'No pass yet. Generation failed; use "Generate entry pass".'
                    : 'The entry pass is generated automatically when the registration is confirmed.'}
                </p>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {/* Sticky action bar on phones */}
      {actions.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-5xl gap-2">{actionButtons(true)}</div>
        </div>
      )}

      {dialog}
      <PassViewer target={viewing ? r : null} canSend={detail.permissions.send} onClose={() => setViewing(false)} onResend={(t) => ask('resend', t)} />
    </main>
  );
}

function BackLink() {
  const back = (useLocation().state as { back?: string } | null)?.back;
  return (
    <Link
      to={back?.startsWith('/admin') ? back : '/admin'}
      className="inline-flex items-center gap-1.5 rounded-lg py-1 text-sm font-semibold text-slate-600 transition hover:text-brand-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> All registrations
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8" aria-busy>
      <Skeleton className="h-4 w-32" />
      <div className="card mt-4 p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="mt-6 h-2 w-full" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </main>
  );
}
