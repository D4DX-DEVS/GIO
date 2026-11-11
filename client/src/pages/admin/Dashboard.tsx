import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpNarrowWide,
  Baby,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Search,
  SearchX,
  SlidersHorizontal,
  Ticket,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import { api, downloadFile, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { FilterOptions, ListResponse, RegistrationDetail, RegistrationItem, Stats } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { Alert, Avatar, Button, Dialog, EmptyState, PassBadge, Skeleton, cx, useToast } from '../../components/ui';
import { DownloadPassLink, PassViewer, useGeneratePass } from '../../components/RegistrationActions';
import { useLayout } from './AdminLayout';

// Every registration gets its pass at submission; "missing" lists the few
// without one (generation failed, or made before passes were automatic).
const PASS_FILTERS: Array<[string, string]> = [
  ['issued', 'Pass issued'],
  ['missing', 'No pass yet'],
];
type SortKey = 'createdAt' | 'name' | 'age' | 'district';
const SORTS: Array<[SortKey, string]> = [
  ['createdAt', 'Registration date'],
  ['name', 'Name'],
  ['age', 'Age'],
  ['district', 'District'],
];
export const PAGE_SIZES = ['10', '20', '50', '100'];

export const CHILDREN_FILTERS: Array<[string, string]> = [
  ['with', 'With children'],
  ['without', 'Without children'],
];
// Keys match AGE_GROUPS on the server.
const AGE_GROUPS: Array<[string, string]> = [
  ['0-3', 'Up to 3'],
  ['4-9', '4–9'],
  ['10-15', '10–15'],
  ['16-20', '16–20'],
  ['21-30', '21–30'],
  ['31-plus', '31 and above'],
];
// Registrants are at least 10 (the form's minimum age); children at most 25
// (the highest limit an admin can set).
export const REGISTRANT_AGE_GROUPS = AGE_GROUPS.slice(2);
const CHILD_AGE_GROUPS = AGE_GROUPS.slice(0, 5);

const FILTER_KEYS = ['pass', 'district', 'area', 'unit', 'children', 'age', 'childAge', 'from', 'to'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const FILTER_LABEL: Record<FilterKey, string> = {
  pass: 'Entry pass',
  district: 'District',
  area: 'Area',
  unit: 'Unit',
  children: 'Children',
  age: 'Age',
  childAge: 'Child age',
  from: 'From',
  to: 'To',
};
const DEFAULTS: Record<string, string> = { sort: 'createdAt', dir: 'desc', page: '1', limit: '20' };

// Dates are picked in the admin's local time zone and sent as instants.
const startOfDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '');

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// --- Building blocks -----------------------------------------------------------

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  allLabel?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span>
      <select
        className={cx('select', value && 'select-active', disabled && 'cursor-not-allowed opacity-60')}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const TONES = {
  ink: { tile: 'bg-slate-100 text-slate-700 ring-slate-200', bar: 'bg-slate-700', ring: 'border-slate-400 ring-slate-300/60' },
  amber: { tile: 'bg-amber-50 text-amber-700 ring-amber-100', bar: 'bg-amber-500', ring: 'border-amber-300 ring-amber-200/70' },
  wine: { tile: 'bg-brand-50 text-brand-600 ring-brand-100', bar: 'bg-brand-600', ring: 'border-brand-300 ring-brand-200/70' },
  green: { tile: 'bg-emerald-50 text-emerald-700 ring-emerald-100', bar: 'bg-emerald-600', ring: 'border-emerald-300 ring-emerald-200/70' },
} as const;

export function StatCard({
  label,
  value,
  total,
  icon: Icon,
  tone,
  note,
  active,
  onClick,
  delay,
}: {
  label: string;
  value: number | undefined;
  total: number | undefined;
  icon: ComponentType<{ className?: string }>;
  tone: keyof typeof TONES;
  note?: ReactNode;
  active: boolean;
  // Without onClick the card is information only, not a filter.
  onClick?: () => void;
  delay: number;
}) {
  const t = TONES[tone];
  const share = value !== undefined && total ? Math.round((value / total) * 100) : 0;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': active } : {})}
      style={{ animationDelay: `${delay}ms` }}
      className={cx(
        'group relative flex min-w-0 animate-fade-up flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-panel transition duration-200 sm:p-5',
        onClick && 'hover:border-slate-300 hover:shadow-soft focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20',
        active && cx('ring-2', t.ring)
      )}
    >
      {/* On phones the icon sits above the label: "REGISTRATIONS" cannot wrap and is wider than the space beside it. */}
      <div className="flex flex-col-reverse items-start gap-2.5 sm:flex-row sm:justify-between sm:gap-3">
        <span className="min-w-0 text-[11px] font-semibold uppercase leading-snug tracking-[0.08em] text-slate-500 sm:text-[12px] sm:tracking-[0.1em]">{label}</span>
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', t.tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      {value === undefined ? (
        <Skeleton className="mt-3 h-10 w-16" />
      ) : (
        <span className="mt-2 font-serif text-[40px] leading-none tabular-nums text-slate-900 sm:text-[48px]">{value.toLocaleString()}</span>
      )}
      <span className="mt-4 block h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <span className={cx('block h-full rounded-full transition-[width] duration-700', t.bar)} style={{ width: `${tone === 'ink' ? (total ? 100 : 0) : share}%` }} />
      </span>
      <span className="mt-2 flex min-h-[1rem] items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate">{note}</span>
        {onClick && (
          <ArrowRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-brand-400 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />
        )}
      </span>
    </Tag>
  );
}

function RowActions({
  r,
  canSend,
  back,
  onGenerate,
  onViewPass,
  layout,
}: {
  r: RegistrationItem;
  canSend: boolean;
  back: { back: string };
  onGenerate: (r: RegistrationItem) => void;
  onViewPass: (r: RegistrationItem) => void;
  layout: 'row' | 'card';
}) {
  const hasPass = r.hasPass && Boolean(r.passId);
  const card = layout === 'card';
  const iconBtn = 'inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-brand-50 hover:text-brand-700';
  const cardBtn = 'btn-line inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold';

  const generate = !r.hasPass && canSend && (
    <Button size={card ? 'md' : 'sm'} variant="soft" onClick={() => onGenerate(r)} className={card ? 'w-full' : ''}>
      <Ticket className="h-4 w-4" aria-hidden /> Generate pass
    </Button>
  );

  if (card) {
    return (
      <div className="space-y-2">
        {generate}
        <div className="flex gap-2">
          <Link to={`/admin/registrations/${r.id}`} state={back} className={cardBtn}>
            <Eye className="h-4 w-4" aria-hidden /> Details
          </Link>
          {hasPass && (
            <>
              <button type="button" onClick={() => onViewPass(r)} className={cardBtn}>
                <Ticket className="h-4 w-4" aria-hidden /> Pass
              </button>
              <DownloadPassLink id={r.id} passId={r.passId} className={cardBtn}>
                <Download className="h-4 w-4" aria-hidden /> Save
              </DownloadPassLink>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {generate}
      {hasPass && (
        <>
          <button type="button" onClick={() => onViewPass(r)} className={iconBtn} title="View entry pass">
            <Ticket className="h-4 w-4" aria-hidden />
            <span className="sr-only">View entry pass of {r.name}</span>
          </button>
          <DownloadPassLink id={r.id} passId={r.passId} className={iconBtn}>
            <Download className="h-4 w-4" aria-hidden />
            <span className="sr-only">Download entry pass of {r.name}</span>
          </DownloadPassLink>
        </>
      )}
      <Link to={`/admin/registrations/${r.id}`} state={back} title="View details" className={iconBtn}>
        <Eye className="h-4 w-4" aria-hidden />
        <span className="sr-only">View details of {r.name}</span>
      </Link>
    </div>
  );
}

function SelectBox({
  checked,
  indeterminate,
  onChange,
  label,
  showLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  showLabel?: boolean;
}) {
  return (
    <label className={cx('-m-2 flex shrink-0 cursor-pointer items-center gap-3 p-2', showLabel && 'text-[13px] font-semibold text-slate-600')}>
      <input
        type="checkbox"
        className="h-[18px] w-[18px] cursor-pointer accent-brand-600"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate);
        }}
        onChange={onChange}
        aria-label={showLabel ? undefined : label}
      />
      {showLabel && label}
    </label>
  );
}

export function SortHeader<K extends string = SortKey>({
  label,
  sortKey,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  sort: string;
  dir: string;
  onSort: (k: K) => void;
  className?: string;
}) {
  const active = sort === sortKey;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={cx('px-3 py-3', className)} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cx('inline-flex items-center gap-1 rounded-md py-0.5 uppercase tracking-wider transition hover:text-slate-900', active && 'text-brand-700')}
      >
        {label}
        <Icon className={cx('h-3.5 w-3.5', !active && 'text-slate-300')} aria-hidden />
      </button>
    </th>
  );
}

export function pageList(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

// --- Page ------------------------------------------------------------------------

export default function Dashboard() {
  const { admin } = useAuth();
  const { stats, refreshStats } = useLayout();
  const toast = useToast();
  const canSend = Boolean(admin?.permissions.includes('send'));
  const canDelete = Boolean(admin?.permissions.includes('delete'));

  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // Lets the detail page link back to this exact list view.
  const back = { back: location.pathname + location.search };
  const get = (k: string) => params.get(k) ?? DEFAULTS[k] ?? '';

  const [searchInput, setSearchInput] = useState(get('search'));
  const search = useDebounced(searchInput, 300);
  const searchRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false);
  const [showDates, setShowDates] = useState(Boolean(params.get('from') || params.get('to')));

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<FilterOptions>({ districts: [], areas: [], units: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [viewing, setViewing] = useState<RegistrationItem | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  // Kept across pages and filters, so registrations can be picked from several
  // pages and deleted together. The delete dialog lists every one.
  const [selected, setSelected] = useState<Map<string, RegistrationItem>>(() => new Map());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { ask, dialog } = useGeneratePass((res: RegistrationDetail) => {
    const { statusHistory, updatedAt, children, ...item } = res.registration;
    setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === item.id ? item : x)) } : d));
    setFlashId(item.id);
    refreshStats();
  });

  useEffect(() => {
    if (!flashId) return undefined;
    const t = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(t);
  }, [flashId]);

  function setParam(updates: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (!v || v === DEFAULTS[k]) next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  }

  useEffect(() => {
    if (search !== get('search')) setParam({ search });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Keep the box in sync when the sidebar changes the URL.
  useEffect(() => {
    const s = params.get('search') ?? '';
    if (s !== searchInput && s !== search) setSearchInput(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // "/" jumps to the search box on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== '/' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of ['search', 'pass', 'district', 'area', 'unit', 'children', 'age', 'childAge', 'sort', 'dir', 'page', 'limit']) {
      const v = params.get(k) ?? DEFAULTS[k];
      if (v) q.set(k, v);
    }
    if (params.get('from')) q.set('from', startOfDay(params.get('from')!));
    if (params.get('to')) q.set('to', endOfDay(params.get('to')!));
    return q.toString();
  }, [params]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    api<ListResponse>(`/api/admin/registrations?${query}`, { signal: ctrl.signal })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(errorMessage(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, reloadKey]);

  const district = get('district');
  const area = get('area');
  useEffect(() => {
    const q = new URLSearchParams();
    if (district) q.set('district', district);
    if (area) q.set('area', area);
    api<FilterOptions>(`/api/admin/filters?${q}`).then(setOptions).catch(() => {});
  }, [district, area, reloadKey]);

  const activeKeys = FILTER_KEYS.filter((k) => params.get(k));
  const page = Number(get('page')) || 1;
  const pass = get('pass');
  const sort = get('sort');
  const dir = get('dir');

  function resetFilters() {
    setSearchInput('');
    setParams(new URLSearchParams(), { replace: true });
  }

  function reload() {
    setReloadKey((k) => k + 1);
    refreshStats();
  }

  // After deleting every row of the last page, show the page that is now last.
  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && data.page > data.pages) setParam({ page: String(data.pages) }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const pageItems = data?.items ?? [];
  const allOnPage = pageItems.length > 0 && pageItems.every((r) => selected.has(r.id));
  const someOnPage = pageItems.some((r) => selected.has(r.id));

  function toggleSelected(r: RegistrationItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.set(r.id, r);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of pageItems) {
        if (allOnPage) next.delete(r.id);
        else next.set(r.id, r);
      }
      return next;
    });
  }

  async function deleteSelected() {
    if (deleting || !selected.size) return;
    setDeleting(true);
    try {
      const res = await api<{ deleted: number }>('/api/admin/registrations/delete', { method: 'POST', body: { ids: [...selected.keys()] } });
      toast('success', `${res.deleted} registration${res.deleted === 1 ? '' : 's'} deleted.`);
      setSelected(new Map());
    } catch (err) {
      // The selection is kept so the admin can try again.
      toast('error', errorMessage(err));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
      reload();
    }
  }

  function onSort(k: SortKey) {
    if (sort === k) setParam({ dir: dir === 'asc' ? 'desc' : 'asc' });
    // Names and districts read naturally A-Z; dates and ages newest/oldest first.
    else setParam({ sort: k, dir: k === 'name' || k === 'district' ? 'asc' : 'desc' });
  }

  const removeFilter = (k: FilterKey) =>
    setParam(k === 'district' ? { district: '', area: '', unit: '' } : k === 'area' ? { area: '', unit: '' } : { [k]: '' });

  const chipValue = (k: FilterKey) => {
    const v = params.get(k) ?? '';
    if (k === 'pass') return PASS_FILTERS.find(([x]) => x === v)?.[1] ?? v;
    if (k === 'children') return CHILDREN_FILTERS.find(([x]) => x === v)?.[1] ?? v;
    if (k === 'age' || k === 'childAge') return AGE_GROUPS.find(([x]) => x === v)?.[1] ?? v;
    if (k === 'from' || k === 'to') return formatDate(`${v}T00:00:00`);
    return v;
  };

  const s: Partial<Stats> = stats ?? {};
  const pct = (n?: number) => (stats && stats.total ? `${Math.round(((n ?? 0) / stats.total) * 100)}% of all registrations` : '');
  const first = data && data.total ? (data.page - 1) * data.limit + 1 : 0;
  const last = data ? Math.min(data.page * data.limit, data.total) : 0;
  const filtered = activeKeys.length > 0 || Boolean(get('search'));
  const firstName = admin?.name.split(/\s+/)[0] ?? '';

  const filterFields = (
    <>
      <FilterSelect label="Entry pass" value={pass} onChange={(v) => setParam({ pass: v })} options={PASS_FILTERS} />
      <FilterSelect
        label="District"
        value={district}
        allLabel="All districts"
        onChange={(v) => setParam({ district: v, area: '', unit: '' })}
        options={options.districts.map((d) => [d, d])}
      />
      <FilterSelect label="Area" value={area} allLabel="All areas" onChange={(v) => setParam({ area: v, unit: '' })} options={options.areas.map((d) => [d, d])} />
      <FilterSelect label="Unit" value={get('unit')} allLabel="All units" onChange={(v) => setParam({ unit: v })} options={options.units.map((d) => [d, d])} />
      <FilterSelect label="Accompanying children" value={get('children')} onChange={(v) => setParam({ children: v })} options={CHILDREN_FILTERS} />
      <FilterSelect label="Age" value={get('age')} allLabel="All ages" onChange={(v) => setParam({ age: v })} options={REGISTRANT_AGE_GROUPS} />
      <FilterSelect label="Child age" value={get('childAge')} allLabel="All ages" onChange={(v) => setParam({ childAge: v })} options={CHILD_AGE_GROUPS} />
    </>
  );
  const dateFields = (
    <>
      <label className="block min-w-0">
        <span className="mb-1.5 block text-xs font-semibold text-slate-500">Registered from</span>
        <input type="date" className="input py-2.5 text-sm" value={get('from')} max={get('to') || undefined} onChange={(e) => setParam({ from: e.target.value })} />
      </label>
      <label className="block min-w-0">
        <span className="mb-1.5 block text-xs font-semibold text-slate-500">Registered to</span>
        <input type="date" className="input py-2.5 text-sm" value={get('to')} min={get('from') || undefined} onChange={(e) => setParam({ to: e.target.value })} />
      </label>
    </>
  );
  const sortFields = (
    <div className="flex gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Sort by</span>
        <select className="select" value={sort} onChange={(e) => setParam({ sort: e.target.value })}>
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              Sort: {l}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="secondary"
        onClick={() => setParam({ dir: dir === 'asc' ? 'desc' : 'asc' })}
        aria-label={dir === 'asc' ? 'Ascending, switch to descending' : 'Descending, switch to ascending'}
        title={dir === 'asc' ? 'Ascending' : 'Descending'}
        className="px-3"
      >
        {dir === 'asc' ? <ArrowUpNarrowWide className="h-[18px] w-[18px]" /> : <ArrowDownWideNarrow className="h-[18px] w-[18px]" />}
      </Button>
    </div>
  );

  const tabs: Array<[string, string, number | undefined]> = [
    ['', 'All', s.total],
    ['issued', 'Pass issued', s.passesIssued],
    ['missing', 'No pass yet', s.withoutPass],
  ];

  return (
    <main className={cx('mx-auto w-full max-w-[90rem] px-4 pt-5 sm:px-6 lg:px-8 lg:pt-7', selected.size ? 'pb-32' : 'pb-16')}>
      {/* Greeting */}
      <section className="flex animate-fade-up flex-col gap-5 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="kicker">{new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <h2 className="display mt-2 text-[34px] leading-[1.05] sm:text-[44px]">
            {greeting()}
            {firstName && (
              <>
                , <em className="text-brand-600">{firstName}</em>
              </>
            )}
          </h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-slate-500">
            {!stats
              ? 'Loading the latest numbers…'
              : stats.withoutPass
                ? `${stats.withoutPass} registration${stats.withoutPass === 1 ? ' has' : 's have'} no entry pass yet. Open ${stats.withoutPass === 1 ? 'it' : 'them'} to generate the pass.`
                : 'Registrants get their entry pass as soon as they submit the form. New registrations appear here.'}
          </p>
        </div>
        {stats && stats.withoutPass > 0 && canSend && (
          <Button onClick={() => setParam({ pass: 'missing' })} className="shadow-glow md:shrink-0">
            <Ticket className="h-4 w-4" aria-hidden /> Show without pass
            <span className="rounded-full bg-white/20 px-1.5 text-[11px] font-bold leading-[18px]">{stats.withoutPass}</span>
          </Button>
        )}
      </section>

      {/* Summary cards; each one also works as a quick filter */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Total Registrations"
          value={s.total}
          total={s.total}
          icon={Users}
          tone="ink"
          note={stats ? 'All time' : ''}
          active={!pass}
          onClick={() => setParam({ pass: '' })}
          delay={0}
        />
        <StatCard
          label="Entry Passes Issued"
          value={s.passesIssued}
          total={s.total}
          icon={Ticket}
          tone="green"
          note={pct(s.passesIssued)}
          active={pass === 'issued'}
          onClick={() => setParam({ pass: pass === 'issued' ? '' : 'issued' })}
          delay={40}
        />
        <StatCard
          label="Without Entry Pass"
          value={s.withoutPass}
          total={s.total}
          icon={TriangleAlert}
          tone="amber"
          note={stats ? (stats.withoutPass ? 'Generate their pass' : 'All have a pass') : ''}
          active={pass === 'missing'}
          onClick={() => setParam({ pass: pass === 'missing' ? '' : 'missing' })}
          delay={80}
        />
        <StatCard
          label="Accompanying Children"
          value={s.children}
          total={s.children}
          icon={Baby}
          tone="wine"
          note={stats ? 'Across all registrations' : ''}
          active={get('children') === 'with'}
          onClick={() => setParam({ children: get('children') === 'with' ? '' : 'with' })}
          delay={120}
        />
      </div>

      {/* Registrations */}
      <section className="card relative mt-5 overflow-hidden" aria-labelledby="list-title">
        {loading && data && (
          <span aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand-100">
            <span className="block h-full w-1/3 animate-progress bg-brand-500" />
          </span>
        )}

        <div className="border-b border-slate-100 px-4 pb-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="list-title" className="display text-[26px] leading-tight">
                Registrations
              </h2>
              <p className="text-[13px] text-slate-500">Search and filter registrations.</p>
            </div>
            {/* Status tabs */}
            <div role="tablist" aria-label="Entry pass" className="scrollbar-none -mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
              {tabs.map(([v, l, n]) => (
                <button
                  key={v || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={pass === v}
                  onClick={() => setParam({ pass: v })}
                  className={cx(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition',
                    pass === v ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  {l}
                  {n !== undefined && (
                    <span className={cx('rounded-full px-1.5 text-[11px] tabular-nums', pass === v ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{n}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Search + sort */}
          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search registrations</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                className="input py-2.5 pl-11 pr-16 text-sm [&::-webkit-search-cancel-button]:hidden"
                placeholder="Search by name, phone, email or place"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                enterKeyHint="search"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-semibold text-slate-400 md:block">
                  /
                </kbd>
              )}
            </label>
            <div className="hidden md:block md:w-[19rem]">{sortFields}</div>
            <div className="flex gap-2">
              <Button variant={activeKeys.length ? 'soft' : 'secondary'} onClick={() => setSheet(true)} className="flex-1 md:hidden">
                <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden /> Filters and sort
                {activeKeys.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold leading-[18px] text-white">{activeKeys.length}</span>}
              </Button>
              <Button variant="secondary" onClick={() => setExporting(true)} disabled={!data?.total} title="Download as Excel or PDF">
                <Download className="h-4 w-4" aria-hidden /> Export
              </Button>
            </div>
          </div>

          {/* Inline filters on tablet and desktop */}
          <div className="mt-3 hidden gap-3 md:grid md:grid-cols-4">
            {filterFields}
            <div className="flex items-end">
              <Button variant={showDates ? 'soft' : 'secondary'} className="w-full" onClick={() => setShowDates((v) => !v)} aria-expanded={showDates}>
                <CalendarRange className="h-4 w-4" aria-hidden /> Date range
              </Button>
            </div>
            {showDates && <div className="col-span-full grid animate-fade-up grid-cols-2 gap-3 xl:max-w-md">{dateFields}</div>}
          </div>

          {(activeKeys.length > 0 || get('search')) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              {activeKeys.map((k) => (
                <span key={k} className="inline-flex max-w-full animate-fade-in items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-brand-800 ring-1 ring-inset ring-brand-200">
                  <span className="text-brand-700/80">{FILTER_LABEL[k]}:</span> <strong className="truncate font-semibold">{chipValue(k)}</strong>
                  <button type="button" onClick={() => removeFilter(k)} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`Remove ${FILTER_LABEL[k]} filter`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={resetFilters} className="px-2 py-1 font-semibold text-slate-500 hover:text-slate-900">
                Clear all
              </button>
            </div>
          )}
        </div>

        <div aria-live="polite" aria-busy={loading}>
          {error && (
            <div className="p-4 sm:p-6">
              <Alert
                title="Registrations could not be loaded"
                action={
                  <Button size="sm" variant="secondary" className="w-full" onClick={reload}>
                    Try again
                  </Button>
                }
              >
                {error}
              </Alert>
            </div>
          )}

          {!error && loading && !data && <ListSkeleton />}

          {!error && data && data.items.length === 0 && (
            <EmptyState
              icon={filtered ? SearchX : Inbox}
              title={filtered ? 'No matching registrations' : 'No registrations yet'}
              action={
                filtered && (
                  <Button variant="secondary" onClick={resetFilters}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> Reset search and filters
                  </Button>
                )
              }
            >
              {filtered ? 'Try a different search term or remove some filters.' : 'New registrations from the public form will appear here.'}
            </EmptyState>
          )}

          {!error && data && data.items.length > 0 && (
            <div className={cx('transition-opacity duration-200', loading && 'pointer-events-none opacity-60')}>
              {/* Cards on phones and tablets */}
              {canDelete && (
                <div className="flex bg-slate-50/60 px-5 pt-4 sm:px-6 lg:hidden">
                  <SelectBox checked={allOnPage} indeterminate={someOnPage && !allOnPage} onChange={togglePage} label="Select all on this page" showLabel />
                </div>
              )}
              <ul className="grid grid-cols-1 gap-3 bg-slate-50/60 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 lg:hidden">
                {data.items.map((r, i) => (
                  <li
                    key={r.id}
                    className={cx(
                      'min-w-0 animate-fade-up rounded-2xl border border-slate-200/80 bg-white p-4 shadow-panel',
                      r.id === flashId && 'animate-flash',
                      !r.hasPass && 'border-l-4 border-l-amber-400',
                      selected.has(r.id) && 'ring-2 ring-brand-300'
                    )}
                    style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={r.name} src={r.photoUrl} className="h-11 w-11 text-sm" />
                      <div className="min-w-0 flex-1">
                        <Link to={`/admin/registrations/${r.id}`} state={back} className="block truncate font-semibold text-slate-900 hover:text-brand-700">
                          {r.name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          <span className="font-mono">{r.regNo}</span> · Age {r.age}
                          {r.childrenCount ? ` · ${childrenLabel(r.childrenCount)}` : ''}
                        </p>
                      </div>
                      {canDelete && <SelectBox checked={selected.has(r.id)} onChange={() => toggleSelected(r)} label={`Select ${r.name}`} />}
                    </div>
                    <dl className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-[13px] text-slate-600">
                      <div className="flex min-w-0 items-center gap-2">
                        <dt className="sr-only">Mobile</dt>
                        <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <dd className="truncate">
                          {r.mobileDisplay}
                          {r.whatsappDisplay && r.whatsapp !== r.mobile && <span className="text-slate-500"> · WhatsApp {r.whatsappDisplay}</span>}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <dt className="sr-only">Email</dt>
                        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <dd className="truncate">{r.email}</dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <dt className="sr-only">Location</dt>
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <dd className="truncate">
                          <span className="font-medium text-slate-700">{r.district}</span>
                          {[r.area, r.unit, r.place].filter(Boolean).map((v) => ` · ${v}`)}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <PassBadge hasPass={r.hasPass} />
                      <span className="text-xs text-slate-400">{formatDate(r.createdAt)}</span>
                    </div>
                    <div className="mt-3">
                      <RowActions r={r} layout="card" canSend={canSend} back={back} onGenerate={ask} onViewPass={setViewing} />
                    </div>
                  </li>
                ))}
              </ul>

              {/* Table on desktops */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full table-auto text-left text-sm">
                  <thead className="border-b border-slate-200/70 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      {canDelete && (
                        <th scope="col" className="w-0 py-3 pl-6 pr-1">
                          <SelectBox checked={allOnPage} indeterminate={someOnPage && !allOnPage} onChange={togglePage} label="Select all on this page" />
                        </th>
                      )}
                      <SortHeader label="Registrant" sortKey="name" sort={sort} dir={dir} onSort={onSort} className={canDelete ? undefined : 'pl-6'} />
                      <th scope="col" className="hidden px-3 py-3 2xl:table-cell">
                        Contact
                      </th>
                      <SortHeader label="Age" sortKey="age" sort={sort} dir={dir} onSort={onSort} className="hidden xl:table-cell" />
                      <SortHeader label="District" sortKey="district" sort={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="Registered" sortKey="createdAt" sort={sort} dir={dir} onSort={onSort} className="hidden xl:table-cell" />
                      <th scope="col" className="px-3 py-3">
                        Entry pass
                      </th>
                      <th scope="col" className="py-3 pl-3 pr-6 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((r) => (
                      <tr
                        key={r.id}
                        className={cx('group transition-colors hover:bg-brand-50/40', r.id === flashId && 'animate-flash', selected.has(r.id) && 'bg-brand-50/60')}
                      >
                        {canDelete && (
                          <td className="py-3.5 pl-6 pr-1">
                            <SelectBox checked={selected.has(r.id)} onChange={() => toggleSelected(r)} label={`Select ${r.name}`} />
                          </td>
                        )}
                        <td className={cx('py-3.5 pr-3', canDelete ? 'pl-3' : 'pl-6')}>
                          <div className="flex items-center gap-3">
                            <span className="relative">
                              <Avatar name={r.name} src={r.photoUrl} className="h-10 w-10 text-xs" />
                              {!r.hasPass && (
                                <span aria-hidden className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <Link
                                to={`/admin/registrations/${r.id}`}
                                state={back}
                                className="block max-w-[13rem] truncate font-semibold text-slate-900 hover:text-brand-700"
                              >
                                {r.name}
                              </Link>
                              <div className="text-xs text-slate-500">
                                <span className="font-mono">{r.regNo}</span>
                                <span className="xl:hidden"> · Age {r.age}</span>
                              </div>
                              <div className="max-w-[13rem] truncate text-xs text-slate-500 2xl:hidden">{r.mobileDisplay}</div>
                              {r.whatsappDisplay && r.whatsapp !== r.mobile && (
                                <div className="max-w-[13rem] truncate text-xs text-slate-500 2xl:hidden">WhatsApp {r.whatsappDisplay}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-3 py-3.5 2xl:table-cell">
                          <div className="whitespace-nowrap text-slate-700">{r.mobileDisplay}</div>
                          {r.whatsappDisplay && r.whatsapp !== r.mobile && <div className="whitespace-nowrap text-xs text-slate-500">WhatsApp {r.whatsappDisplay}</div>}
                          <div className="max-w-[15rem] truncate text-xs text-slate-500">{r.email}</div>
                        </td>
                        <td className="hidden px-3 py-3.5 tabular-nums text-slate-700 xl:table-cell">{r.age}</td>
                        <td className="px-3 py-3.5">
                          <div className="font-medium text-slate-800">{r.district}</div>
                          {(r.area || r.unit) && (
                            <div className="max-w-[11rem] truncate text-xs text-slate-500">{[r.area, r.unit].filter(Boolean).join(' · ')}</div>
                          )}
                          {(r.place || Boolean(r.childrenCount)) && (
                            <div className="max-w-[11rem] truncate text-xs text-slate-500">
                              {[r.place, r.childrenCount ? childrenLabel(r.childrenCount) : ''].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-3.5 text-slate-600 xl:table-cell">{formatDate(r.createdAt)}</td>
                        <td className="px-3 py-3.5">
                          <PassBadge hasPass={r.hasPass} />
                        </td>
                        <td className="py-3.5 pl-3 pr-6">
                          <RowActions r={r} layout="row" canSend={canSend} back={back} onGenerate={ask} onViewPass={setViewing} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <nav className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6" aria-label="Pagination">
                <div className="flex items-center justify-between gap-3 text-[13px] text-slate-500 sm:justify-start">
                  <span>
                    <strong className="font-semibold text-slate-700">{first}</strong>–<strong className="font-semibold text-slate-700">{last}</strong> of{' '}
                    <strong className="font-semibold text-slate-700">{data.total}</strong>
                  </span>
                  <label className="flex items-center gap-2">
                    <span>Rows</span>
                    <select className="select w-auto py-1.5 pl-2.5 pr-8 text-[13px]" value={get('limit')} onChange={(e) => setParam({ limit: e.target.value })}>
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center justify-center gap-1">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) }, false)} aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </Button>
                  {pageList(data.page, data.pages).map((p, i) =>
                    p === '…' ? (
                      <span key={`gap-${i}`} className="px-1 text-slate-400">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setParam({ page: String(p) }, false)}
                        aria-current={p === data.page ? 'page' : undefined}
                        className={cx(
                          'h-9 min-w-[2.25rem] rounded-lg px-2 text-[13px] font-semibold tabular-nums transition',
                          p === data.page ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                        )}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <Button variant="secondary" size="sm" disabled={page >= data.pages} onClick={() => setParam({ page: String(page + 1) }, false)} aria-label="Next page">
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </nav>
            </div>
          )}
        </div>
      </section>

      {/* Filters and sort as a bottom sheet on phones */}
      <Dialog
        open={sheet}
        title="Filters and sort"
        description={data ? `${data.total} registration${data.total === 1 ? '' : 's'} match` : undefined}
        onClose={() => setSheet(false)}
        footer={
          <>
            <Button variant="secondary" onClick={resetFilters} disabled={!filtered}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Reset
            </Button>
            <Button onClick={() => setSheet(false)} data-autofocus>
              Show results
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-1">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Sort by</span>
            {sortFields}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filterFields}
            {dateFields}
          </div>
        </div>
      </Dialog>

      {/* Selection bar, pinned to the bottom of the screen */}
      {canDelete && selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-[17rem]">
          <div
            role="region"
            aria-label="Selected registrations"
            className="pointer-events-auto flex w-full max-w-xl animate-fade-up items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 pl-4 shadow-lift"
          >
            <p className="min-w-0 flex-1 truncate text-sm text-slate-600">
              <strong className="font-semibold tabular-nums text-slate-900">{selected.size}</strong> selected
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
              Clear
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={confirmDelete}
        title={`Delete ${selected.size} registration${selected.size === 1 ? '' : 's'}?`}
        icon={
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-inset ring-red-100">
            <Trash2 className="h-5 w-5" aria-hidden />
          </span>
        }
        onClose={() => !deleting && setConfirmDelete(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={deleteSelected}>
              {deleting ? 'Deleting…' : `Delete ${selected.size}`}
            </Button>
          </>
        }
      >
        <p>Their entry passes stop working, and their photos and pass images are removed from storage. This cannot be undone.</p>
        <ul className="mt-3 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
          {[...selected.values()].map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2">
              <span className="truncate font-medium text-slate-800">{r.name}</span>
              <span className="shrink-0 font-mono text-xs text-slate-500">{r.regNo}</span>
            </li>
          ))}
        </ul>
      </Dialog>

      <ExportDialog open={exporting} onClose={() => setExporting(false)} query={query} total={data?.total ?? 0} filtered={filtered} />
      {dialog}
      <PassViewer target={viewing} onClose={() => setViewing(null)} />
    </main>
  );
}

// Exports every registration the list shows (all pages) with the same search, filters and sort.
// The check-in and check-out pages pass their own export endpoint and noun.
export function ExportDialog({
  open,
  onClose,
  query,
  total,
  filtered,
  path = '/api/admin/registrations/export',
  noun = 'registration',
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  total: number;
  filtered: boolean;
  path?: string;
  noun?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf'>('');

  async function run(format: 'xlsx' | 'pdf') {
    if (busy) return;
    setBusy(format);
    try {
      const q = new URLSearchParams(query);
      q.delete('page');
      q.delete('limit');
      q.set('format', format);
      q.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
      await downloadFile(`${path}?${q}`, `${noun}s.${format}`);
      onClose();
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  const count = `${total.toLocaleString()} ${noun}${total === 1 ? '' : 's'}`;
  const option =
    'flex flex-1 flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-center transition hover:border-brand-300 hover:bg-brand-50/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20 disabled:cursor-not-allowed disabled:opacity-60';
  const formats: Array<['xlsx' | 'pdf', string, string, ComponentType<{ className?: string }>, string]> = [
    ['xlsx', 'Excel', 'Every field, to sort and filter', FileSpreadsheet, 'text-emerald-700'],
    ['pdf', 'PDF', 'A table to print or share', FileText, 'text-brand-600'],
  ];

  return (
    <Dialog
      open={open}
      title={`Export ${noun}s`}
      description={filtered ? `${count} ${total === 1 ? 'matches' : 'match'} the current search and filters.` : `All ${count}.`}
      icon={
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
          <Download className="h-5 w-5" aria-hidden />
        </span>
      }
      onClose={() => !busy && onClose()}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        {formats.map(([format, label, note, Icon, tone], i) => (
          <button key={format} type="button" className={option} onClick={() => run(format)} disabled={Boolean(busy)} data-autofocus={i === 0 || undefined}>
            {busy === format ? <Loader2 className={cx('h-7 w-7 animate-spin', tone)} aria-hidden /> : <Icon className={cx('h-7 w-7', tone)} />}
            <span className="font-semibold text-slate-900">{busy === format ? 'Preparing…' : label}</span>
            <span className="text-xs text-slate-500">{note}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export function ListSkeleton() {
  return (
    <div aria-hidden>
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200/80 bg-white p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="mt-4 h-20 w-full rounded-xl" />
            <Skeleton className="mt-3 h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>
      <div className="hidden divide-y divide-slate-100 lg:block">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-8 w-36 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

export const childrenLabel = (n: number) => `${n} ${n === 1 ? 'child' : 'children'}`;
