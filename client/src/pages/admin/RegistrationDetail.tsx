import { useCallback, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Expand, FileCheck2, History, Ticket } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { RegistrationDetail as Detail } from '../../lib/types';
import { STATUS_LABEL, formatDateTime } from '../../lib/format';
import { Alert, Avatar, Button, PassBadge, Skeleton } from '../../components/ui';
import { DownloadPassLink, PassImage, PassViewer, useGeneratePass } from '../../components/RegistrationActions';
import { useLayout } from './AdminLayout';

// Registrations from the original form have no gender, place, WhatsApp
// number or children.
const NOT_RECORDED = 'Not recorded';

function childrenText(children: Detail['registration']['children']) {
  if (children === null) return NOT_RECORDED;
  if (children.length === 0) return 'None';
  return children.map((c) => (c.name ? `${c.name} (age ${c.age})` : `Age ${c.age}`)).join(', ');
}

function Card({ title, icon: Icon, children, aside }: { title: string; icon: ComponentType<{ className?: string }>; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 pb-3.5">
        <h2 className="display flex items-center gap-2.5 text-[22px] leading-tight">
          <Icon className="h-[18px] w-[18px] text-brand-400" /> {title}
        </h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function RegistrationDetail() {
  const { id = '' } = useParams();
  const { refreshStats } = useLayout();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [imgKey, setImgKey] = useState(0);
  const [viewing, setViewing] = useState(false);

  const load = useCallback(() => {
    setError('');
    api<Detail>(`/api/admin/registrations/${id}`)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(load, [load]);

  const { ask, dialog } = useGeneratePass((res) => {
    setDetail(res);
    setImgKey((k) => k + 1);
    refreshStats();
  });

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
  const hasPass = detail.pass?.status === 'active' && r.hasPass;
  const canGenerate = !r.hasPass && detail.permissions.send;

  const generateButton = (full: boolean) => (
    <Button onClick={() => ask(r)} className={full ? 'flex-1' : ''}>
      <Ticket className="h-4 w-4" aria-hidden /> Generate entry pass
    </Button>
  );

  return (
    <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 md:pb-16 lg:px-8 lg:pt-7">
      <BackLink />

      {/* Header */}
      <div className="card mt-4 animate-fade-up p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {r.photoUrl ? (
              // Opens the full photo, to compare with the person at the desk.
              <a href={r.photoUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20" title="Open the full photo">
                <img src={r.photoUrl} alt={`Photo of ${r.name}`} className="h-24 w-[4.8rem] rounded-2xl object-cover ring-1 ring-slate-200" />
              </a>
            ) : (
              <Avatar name={r.name} className="h-14 w-14 text-lg" />
            )}
            <div className="min-w-0">
              <h1 className="display break-words text-[30px] leading-[1.1] sm:text-[38px]">{r.name}</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                <span className="font-mono font-medium text-slate-700">{r.regNo}</span> · Registered {formatDateTime(r.createdAt)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <PassBadge hasPass={r.hasPass} />
              </div>
            </div>
          </div>
          {canGenerate && <div className="hidden gap-2 md:flex">{generateButton(false)}</div>}
        </div>

        {!r.hasPass && (
          <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200/70">
            {r.status === 'submitted'
              ? 'This registration was made before entry passes were generated automatically.'
              : 'The entry pass could not be generated when this registration was submitted.'}{' '}
            {detail.permissions.send ? 'Generate it now.' : 'An admin needs to generate it.'}
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
                ['Gender', r.gender ?? NOT_RECORDED],
                ['Phone number', r.mobileDisplay],
                ['WhatsApp number', r.whatsappDisplay ? (r.whatsapp === r.mobile ? `${r.whatsappDisplay} (same as phone)` : r.whatsappDisplay) : NOT_RECORDED],
                ['Email', r.email],
                ['Place', r.place ?? NOT_RECORDED],
                ['District', r.district],
                ['Area', r.area || 'Not given'],
                ['Unit', r.unit || 'Not given'],
                [
                  r.childrenCount ? `Accompanying children (${r.childrenCount})` : 'Accompanying children',
                  // Names and ages are visible to admins only.
                  r.children ? childrenText(r.children) : r.childrenCount === null ? NOT_RECORDED : String(r.childrenCount),
                ],
                ['Registration no.', r.regNo],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="label-caps">{k}</dt>
                  <dd className="mt-0.5 break-words text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="History" icon={History}>
            <ol className="relative space-y-4 border-l-2 border-slate-200/70 pl-5">
              {[...r.statusHistory].reverse().map((h, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[27px] top-0.5 h-3 w-3 rounded-full border-2 border-white bg-brand-600 ring-2 ring-brand-100" />
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
                    <dt className="text-slate-500">Generated</dt>
                    <dd className="text-slate-800">{formatDateTime(r.passGeneratedAt ?? detail.pass.issuedAt)}</dd>
                  </div>
                </dl>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setViewing(true)}>
                    <Expand className="h-4 w-4" aria-hidden /> View
                  </Button>
                  <DownloadPassLink id={r.id} passId={detail.pass.passId} className="btn-line min-h-[44px] rounded-full text-sm" />
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <Ticket className="mx-auto h-7 w-7 text-brand-300" aria-hidden />
                <p className="mt-2 text-sm text-slate-500">No pass yet. Use “Generate entry pass”.</p>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {/* Sticky action bar on phones */}
      {canGenerate && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-slate-50/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-5xl gap-2">{generateButton(true)}</div>
        </div>
      )}

      {dialog}
      <PassViewer target={viewing ? r : null} onClose={() => setViewing(false)} />
    </main>
  );
}

function BackLink() {
  const back = (useLocation().state as { back?: string } | null)?.back;
  return (
    <Link
      to={back?.startsWith('/admin') ? back : '/admin'}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg py-1 text-sm font-semibold text-slate-600 transition hover:text-brand-600"
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
