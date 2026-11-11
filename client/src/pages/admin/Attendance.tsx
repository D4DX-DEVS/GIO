// Event day check-in and check-out. Volunteers scan the QR code on each entry
// pass with the device camera (or type the pass ID, or use a handheld USB /
// Bluetooth scanner, which types into the same box). The server records each
// pass once per action and says when it was scanned before; this page shows
// the outcome and the list of everyone checked in or out.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import jsQR from 'jsqr';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Camera,
  CameraOff,
  CircleCheck,
  CircleX,
  Clock,
  DoorOpen,
  Download,
  Eye,
  Inbox,
  LogIn,
  LogOut,
  RotateCcw,
  ScanQrCode,
  Search,
  SearchX,
  SlidersHorizontal,
  TriangleAlert,
  Undo2,
  UserCheck,
  Users,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { AttendanceAction, AttendanceStats, FilterOptions, ListResponse, RegistrationItem, ScanResponse } from '../../lib/types';
import { formatDate, formatScanTime, formatTime } from '../../lib/format';
import { Alert, Avatar, Button, Dialog, EmptyState, cx, useToast } from '../../components/ui';
import {
  CHILDREN_FILTERS,
  ExportDialog,
  FilterSelect,
  ListSkeleton,
  PAGE_SIZES,
  REGISTRANT_AGE_GROUPS,
  SortHeader,
  StatCard,
  childrenLabel,
  pageList,
  useDebounced,
} from './Dashboard';

const COPY = {
  in: { title: 'Check in', done: 'Checked in', noun: 'check-in', list: 'Checked in', other: '/admin/check-out' },
  out: { title: 'Check out', done: 'Checked out', noun: 'check-out', list: 'Checked out', other: '/admin/check-in' },
} as const;

type SortKey = 'time' | 'name' | 'age' | 'district';
const SORTS: Array<[SortKey, string]> = [
  ['time', 'Scan time'],
  ['name', 'Name'],
  ['age', 'Age'],
  ['district', 'District'],
];
// Check-in list only.
const STATE_FILTERS: Array<[string, string]> = [
  ['inside', 'Not checked out'],
  ['left', 'Checked out'],
];
const FILTER_KEYS = ['state', 'district', 'area', 'unit', 'children', 'age'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const FILTER_LABEL: Record<FilterKey, string> = { state: 'Status', district: 'District', area: 'Area', unit: 'Unit', children: 'Children', age: 'Age' };
const DEFAULTS: Record<string, string> = { sort: 'time', dir: 'desc', page: '1', limit: '20' };

// Lists and head counts refresh on their own, so every gate sees the others' scans.
const REFRESH_MS = 15_000;
// A QR code held in front of the camera is read many times a second. The same
// code is ignored until it has been out of view this long; shown again after
// that, it is sent again (and reported as already scanned).
const SAME_CODE_MS = 3_000;

// --- Sound and vibration ------------------------------------------------------

let audio: AudioContext | null = null;

/** Browsers only allow sound after a tap, so this is called from the Start camera and submit buttons. */
function unlockSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

/** One high beep for a recorded scan, two low ones for anything else. */
function signal(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 90 : [140, 90, 140]);
    if (!audio) return;
    const tones = ok ? [1046] : [262, 262];
    tones.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = ok ? 'sine' : 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.07;
      osc.connect(gain).connect(audio!.destination);
      const t = audio!.currentTime + i * 0.2;
      osc.start(t);
      osc.stop(t + (ok ? 0.15 : 0.13));
    });
  } catch {
    // Sound is a convenience; the result card is what counts.
  }
}

// --- Camera -------------------------------------------------------------------

const CAMERA_KEY = 'gate.camera';

function cameraErrorText(err: unknown) {
  const name = (err as { name?: string })?.name;
  if (!window.isSecureContext) return 'The camera only works over a secure (https) connection. Type the pass ID instead.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow the camera for this site in the browser settings, or type the pass ID.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Type the pass ID instead.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'The camera could not be started. Type the pass ID instead.';
}

function QrCamera({ paused, onCode }: { paused: boolean; onCode: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(() => {
    try {
      return localStorage.getItem(CAMERA_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    setReady(false);
    setError('');

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
        });
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        if (stopped) return;
        setReady(true);
        // Labels are only available once the camera is allowed.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!stopped) setCameras(all.filter((d) => d.kind === 'videoinput'));

        // Reads the centre square of the picture (inside the guide), at most
        // 640 px, about eight times a second.
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        let last = 0;
        const tick = (now: number) => {
          if (stopped) return;
          frame = requestAnimationFrame(tick);
          if (now - last < 120 || pausedRef.current || video.readyState < 2 || !video.videoWidth) return;
          last = now;
          const side = Math.min(video.videoWidth, video.videoHeight);
          const size = Math.min(side, 640);
          canvas.width = size;
          canvas.height = size;
          ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
          const hit = jsQR(ctx.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: 'dontInvert' });
          if (hit?.data) onCodeRef.current(hit.data);
        };
        frame = requestAnimationFrame(tick);
      } catch (err) {
        if (stopped) return;
        // A remembered camera that is gone: fall back to the default one.
        if (deviceId && (err as { name?: string })?.name === 'OverconstrainedError') {
          setDeviceId('');
          return;
        }
        setError(cameraErrorText(err));
        setActive(false);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active, deviceId]);

  function pickCamera(id: string) {
    setDeviceId(id);
    try {
      localStorage.setItem(CAMERA_KEY, id);
    } catch {
      // Remembering the camera is a convenience.
    }
  }

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-slate-900 sm:aspect-[4/3]">
        <video ref={videoRef} muted playsInline className={cx('h-full w-full object-cover', !(active && ready) && 'invisible')} />
        {active && ready && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="aspect-square h-[78%] max-w-[90%] rounded-3xl border-[3px] border-white/90 shadow-[0_0_0_9999px_rgb(15_23_42/0.45)]" />
            {paused && <div className="absolute inset-0 animate-fade-in bg-slate-950/30" />}
          </div>
        )}
        {!(active && ready) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-slate-300">
            {active ? (
              <p className="text-sm">Starting the camera…</p>
            ) : (
              <>
                <ScanQrCode className="h-12 w-12 text-slate-500" aria-hidden />
                <Button
                  onClick={() => {
                    unlockSound();
                    setActive(true);
                  }}
                >
                  <Camera className="h-4 w-4" aria-hidden /> Start camera
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Alert tone="warning">{error}</Alert>
        </div>
      )}
      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cameras.length > 1 && (
            <label className="min-w-0 flex-1">
              <span className="sr-only">Camera</span>
              <select className="select py-2 text-[13px]" value={deviceId} onChange={(e) => pickCamera(e.target.value)}>
                <option value="">Default camera</option>
                {cameras.map((c, i) => (
                  <option key={c.deviceId || i} value={c.deviceId}>
                    {c.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button variant="secondary" size="sm" onClick={() => setActive(false)} className={cameras.length > 1 ? '' : 'ml-auto'}>
            <CameraOff className="h-4 w-4" aria-hidden /> Stop camera
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Scan result -----------------------------------------------------------------

type Outcome = {
  tone: 'success' | 'warning' | 'error';
  title: string;
  message: string;
  registration?: RegistrationItem;
  // Distinguishes two identical outcomes in a row, so the card animates again.
  key: number;
};

function outcomeOf(res: ScanResponse, key: number): Outcome {
  if (res.result === 'invalid') return { tone: 'error', title: 'Not a valid pass', message: res.message, key };
  const r = res.registration;
  const by = (name: string | null) => (name ? ` by ${name}` : '');
  if (res.result === 'ok') {
    return res.action === 'in'
      ? { tone: 'success', title: 'Checked in', message: `Checked in at ${formatScanTime(r.checkedInAt)}.`, registration: r, key }
      : { tone: 'success', title: 'Checked out', message: `Checked out at ${formatScanTime(r.checkedOutAt)}.`, registration: r, key };
  }
  if (res.result === 'not_checked_in') {
    return {
      tone: 'warning',
      title: 'Not checked in yet',
      message: 'This pass was never checked in, so it cannot be checked out. Check the person in first.',
      registration: r,
      key,
    };
  }
  return res.action === 'in'
    ? {
        tone: 'error',
        title: 'Already checked in',
        message: `This QR code was already scanned for check-in at ${formatScanTime(r.checkedInAt)}${by(r.checkedInByName)}.`,
        registration: r,
        key,
      }
    : {
        tone: 'error',
        title: 'Already checked out',
        message: `This QR code was already scanned for check-out at ${formatScanTime(r.checkedOutAt)}${by(r.checkedOutByName)}.`,
        registration: r,
        key,
      };
}

const TONE = {
  success: { box: 'border-emerald-300 bg-emerald-50', head: 'bg-emerald-600 text-white', Icon: CircleCheck },
  warning: { box: 'border-amber-300 bg-amber-50', head: 'bg-amber-500 text-white', Icon: TriangleAlert },
  error: { box: 'border-red-300 bg-red-50', head: 'bg-red-700 text-white', Icon: CircleX },
} as const;

function ResultCard({ outcome, onUndo }: { outcome: Outcome | null; onUndo?: (r: RegistrationItem) => void }) {
  if (!outcome) {
    return (
      <div className="flex h-full min-h-[14rem] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center">
        <ScanQrCode className="h-10 w-10 text-slate-300" aria-hidden />
        <p className="mt-3 font-semibold text-slate-700">Ready to scan</p>
        <p className="mt-1 max-w-xs text-sm text-slate-500">Show the QR code on the entry pass to the camera, or type the pass ID.</p>
      </div>
    );
  }
  const t = TONE[outcome.tone];
  const r = outcome.registration;
  return (
    <div key={outcome.key} role="status" aria-live="assertive" className={cx('animate-pop-in overflow-hidden rounded-2xl border-2', t.box)}>
      <div className={cx('flex items-center gap-3 px-4 py-3.5', t.head)}>
        <t.Icon className="h-8 w-8 shrink-0" aria-hidden />
        <p className="text-xl font-bold leading-tight sm:text-2xl">{outcome.title}</p>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-[15px] font-medium leading-snug text-slate-800">{outcome.message}</p>
        {r && (
          <div className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200">
            <Avatar name={r.name} src={r.photoUrl} className="h-16 w-16 text-base" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate text-base font-bold text-slate-900">{r.name}</p>
              <p className="text-slate-500">
                <span className="font-mono">{r.regNo}</span> · Age {r.age}
                {r.childrenCount ? ` · ${childrenLabel(r.childrenCount)}` : ''}
              </p>
              <p className="truncate text-slate-600">{[r.district, r.area, r.unit, r.place].filter(Boolean).join(' · ')}</p>
              <p className="truncate text-slate-500">{r.mobileDisplay}</p>
            </div>
          </div>
        )}
        {r && (r.checkedInAt || r.checkedOutAt) && (
          <dl className="grid grid-cols-1 gap-1 text-[13px] text-slate-600 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-slate-500">Checked in</dt>
              <dd>{r.checkedInAt ? formatScanTime(r.checkedInAt) : 'Not yet'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-500">Checked out</dt>
              <dd>{r.checkedOutAt ? formatScanTime(r.checkedOutAt) : 'Not yet'}</dd>
            </div>
          </dl>
        )}
        {r && outcome.tone === 'success' && onUndo && (
          <Button variant="ghost" size="sm" onClick={() => onUndo(r)} className="-ml-2">
            <Undo2 className="h-4 w-4" aria-hidden /> Scanned by mistake? Undo
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Page ------------------------------------------------------------------------

export default function Attendance({ mode }: { mode: AttendanceAction }) {
  const copy = COPY[mode];
  const { admin } = useAuth();
  const toast = useToast();
  const canScan = Boolean(admin?.permissions.includes('gate'));
  const canUndo = Boolean(admin?.permissions.includes('approve'));
  const location = useLocation();
  const back = { back: location.pathname + location.search };

  // Scanning
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const busyRef = useRef(false);
  const lastSeen = useRef({ code: '', at: 0 });
  const outcomeKey = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // List
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? DEFAULTS[k] ?? '';
  const [searchInput, setSearchInput] = useState(get('search'));
  const search = useDebounced(searchInput, 300);
  const [data, setData] = useState<ListResponse | null>(null);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<FilterOptions>({ districts: [], areas: [], units: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [undoing, setUndoing] = useState<{ r: RegistrationItem; action: AttendanceAction } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const reload = () => setReloadKey((k) => k + 1);

  async function submit(raw: string, fromCamera: boolean) {
    const value = raw.trim();
    if (!value || busyRef.current) return;
    const now = Date.now();
    if (fromCamera && value === lastSeen.current.code && now - lastSeen.current.at < SAME_CODE_MS) {
      lastSeen.current.at = now;
      return;
    }
    busyRef.current = true;
    setScanning(true);
    lastSeen.current = { code: value, at: now };
    try {
      const res = await api<ScanResponse>('/api/admin/attendance/scan', { method: 'POST', body: { code: value, action: mode } });
      outcomeKey.current += 1;
      setOutcome(outcomeOf(res, outcomeKey.current));
      signal(res.result === 'ok');
      if (res.result === 'ok') reload();
    } catch (err) {
      outcomeKey.current += 1;
      setOutcome({ tone: 'error', title: 'Not recorded', message: `${errorMessage(err)} The scan was not saved. Scan the pass again.`, key: outcomeKey.current });
      signal(false);
      // Let the same code be retried straight away.
      lastSeen.current = { code: '', at: 0 };
    } finally {
      busyRef.current = false;
      setScanning(false);
    }
  }

  function onManualSubmit(e: FormEvent) {
    e.preventDefault();
    unlockSound();
    const value = code;
    setCode('');
    void submit(value, false);
    inputRef.current?.focus();
  }

  // --- List query

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

  const query = useMemo(() => {
    const q = new URLSearchParams({ type: mode });
    for (const k of ['search', 'state', 'district', 'area', 'unit', 'children', 'age', 'sort', 'dir', 'page', 'limit']) {
      if (k === 'state' && mode === 'out') continue;
      const v = params.get(k) ?? DEFAULTS[k];
      if (v) q.set(k, v);
    }
    return q.toString();
  }, [params, mode]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    api<ListResponse>(`/api/admin/attendance?${query}`, { signal: ctrl.signal })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(errorMessage(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, reloadKey]);

  useEffect(() => {
    api<AttendanceStats>('/api/admin/attendance/stats').then(setStats).catch(() => {});
  }, [reloadKey]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setReloadKey((k) => k + 1);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const district = get('district');
  const area = get('area');
  useEffect(() => {
    const q = new URLSearchParams();
    if (district) q.set('district', district);
    if (area) q.set('area', area);
    api<FilterOptions>(`/api/admin/filters?${q}`).then(setOptions).catch(() => {});
  }, [district, area]);

  // After the last row of the last page is undone, show the page that is now last.
  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && data.page > data.pages) setParam({ page: String(data.pages) }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filterKeys = mode === 'in' ? FILTER_KEYS : FILTER_KEYS.filter((k) => k !== 'state');
  const activeKeys = filterKeys.filter((k) => params.get(k));
  const filtered = activeKeys.length > 0 || Boolean(get('search'));
  const page = Number(get('page')) || 1;
  const sort = get('sort');
  const dir = get('dir');
  const state = get('state');

  function resetFilters() {
    setSearchInput('');
    setParams(new URLSearchParams(), { replace: true });
  }

  function onSort(k: SortKey) {
    if (sort === k) setParam({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else setParam({ sort: k, dir: k === 'name' || k === 'district' ? 'asc' : 'desc' });
  }

  const removeFilter = (k: FilterKey) =>
    setParam(k === 'district' ? { district: '', area: '', unit: '' } : k === 'area' ? { area: '', unit: '' } : { [k]: '' });

  const chipValue = (k: FilterKey) => {
    const v = params.get(k) ?? '';
    if (k === 'state') return STATE_FILTERS.find(([x]) => x === v)?.[1] ?? v;
    if (k === 'children') return CHILDREN_FILTERS.find(([x]) => x === v)?.[1] ?? v;
    if (k === 'age') return REGISTRANT_AGE_GROUPS.find(([x]) => x === v)?.[1] ?? v;
    return v;
  };

  // --- Undo

  function askUndo(r: RegistrationItem, action: AttendanceAction = mode) {
    setUndoing({ r, action });
  }

  async function confirmUndo() {
    if (!undoing || undoBusy) return;
    setUndoBusy(true);
    try {
      const res = await api<{ registration: RegistrationItem }>(`/api/admin/attendance/${undoing.r.id}/undo`, {
        method: 'POST',
        body: { action: undoing.action },
      });
      toast('success', `${undoing.action === 'in' ? 'Check-in' : 'Check-out'} of ${res.registration.name} undone. The pass can be scanned again.`);
      if (outcome?.registration?.id === res.registration.id) setOutcome(null);
      lastSeen.current = { code: '', at: 0 };
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setUndoBusy(false);
      setUndoing(null);
      reload();
    }
  }

  // --- Pieces

  const s = stats;
  const filterFields = (
    <>
      {mode === 'in' && <FilterSelect label="Status" value={state} onChange={(v) => setParam({ state: v })} options={STATE_FILTERS} />}
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

  const undoAction = (r: RegistrationItem) => {
    if (!canUndo) return null;
    // A check-in can only be undone while the person is not checked out.
    if (mode === 'in' ? !r.checkedInAt || r.checkedOutAt : !r.checkedOutAt) return null;
    return r;
  };

  const timeCell = (at: string | null, by: string | null) =>
    at ? (
      <>
        <div className="whitespace-nowrap font-medium tabular-nums text-slate-800">{formatTime(at)}</div>
        <div className="whitespace-nowrap text-xs text-slate-500">
          {formatDate(at)}
          {by && ` · ${by}`}
        </div>
      </>
    ) : (
      <span className="text-slate-400">Not yet</span>
    );

  const first = data && data.total ? (data.page - 1) * data.limit + 1 : 0;
  const last = data ? Math.min(data.page * data.limit, data.total) : 0;
  const people = (n: number, kids: number) => (kids ? `${n + kids} incl. ${childrenLabel(kids)}` : `${n} ${n === 1 ? 'person' : 'people'}`);

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      {/* Scanner first: on a phone at the gate it is what the volunteer needs on screen. */}
      {canScan && (
        <section className="card mb-5 p-4 sm:p-6" aria-labelledby="scan-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="scan-title" className="display text-[26px] leading-tight">
                {copy.title}
              </h2>
              <p className="text-[13px] text-slate-500">Each QR code can be scanned once for check-in and once for check-out.</p>
            </div>
            <div role="tablist" aria-label="Scan for" className="inline-flex rounded-full bg-slate-100 p-1">
              {(['in', 'out'] as const).map((m) => (
                <Link
                  key={m}
                  to={m === 'in' ? '/admin/check-in' : '/admin/check-out'}
                  role="tab"
                  aria-selected={mode === m}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition',
                    mode === m ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {m === 'in' ? <LogIn className="h-4 w-4" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}
                  {COPY[m].title}
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <QrCamera paused={scanning} onCode={(text) => void submit(text, true)} />
              <form onSubmit={onManualSubmit} className="mt-3 flex gap-2">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Pass ID or QR code</span>
                  <input
                    ref={inputRef}
                    className="input py-2.5 font-mono text-sm uppercase placeholder:font-sans placeholder:normal-case"
                    placeholder="Type the pass ID, e.g. ABCD-EFGH-JKMN"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                  />
                </label>
                <Button type="submit" loading={scanning} disabled={!code.trim()}>
                  {copy.title}
                </Button>
              </form>
            </div>
            <ResultCard outcome={outcome} onUndo={canUndo ? (r) => askUndo(r) : undefined} />
          </div>
        </section>
      )}

      {/* Head counts */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Checked in"
          value={s?.checkedIn}
          total={s?.registrations}
          icon={UserCheck}
          tone="green"
          note={s ? people(s.checkedIn, s.checkedInChildren) : ''}
          active={mode === 'in' && !state}
          onClick={mode === 'in' ? () => setParam({ state: '' }) : undefined}
          delay={0}
        />
        <StatCard
          label="Inside now"
          value={s?.inside}
          total={s?.registrations}
          icon={Users}
          tone="wine"
          note={s ? people(s.inside, s.insideChildren) : ''}
          active={mode === 'in' && state === 'inside'}
          onClick={mode === 'in' ? () => setParam({ state: state === 'inside' ? '' : 'inside' }) : undefined}
          delay={40}
        />
        <StatCard
          label="Checked out"
          value={s?.checkedOut}
          total={s?.registrations}
          icon={DoorOpen}
          tone="ink"
          note={s ? people(s.checkedOut, s.checkedOutChildren) : ''}
          active={mode === 'in' && state === 'left'}
          onClick={mode === 'in' ? () => setParam({ state: state === 'left' ? '' : 'left' }) : undefined}
          delay={80}
        />
        <StatCard
          label="Not arrived"
          value={s ? s.registrations - s.checkedIn : undefined}
          total={s?.registrations}
          icon={Clock}
          tone="amber"
          note={s ? `Of ${s.registrations.toLocaleString()} registrations` : ''}
          active={false}
          delay={120}
        />
      </div>

      {/* List */}
      <section className="card relative mt-5 overflow-hidden" aria-labelledby="list-title">
        {loading && data && (
          <span aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand-100">
            <span className="block h-full w-1/3 animate-progress bg-brand-500" />
          </span>
        )}

        <div className="border-b border-slate-100 px-4 pb-4 pt-5 sm:px-6">
          <div>
            <h2 id="list-title" className="display text-[26px] leading-tight">
              {copy.list}
            </h2>
            <p className="text-[13px] text-slate-500">
              {mode === 'in' ? 'Everyone whose pass was scanned at check-in.' : 'Everyone whose pass was scanned at check-out.'} Updates every few seconds.
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                className="input py-2.5 pl-11 pr-10 text-sm [&::-webkit-search-cancel-button]:hidden"
                placeholder="Search by name, phone, email, reg no or pass ID"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                enterKeyHint="search"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
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

          <div className={cx('mt-3 hidden gap-3 md:grid', mode === 'in' ? 'md:grid-cols-3 xl:grid-cols-6' : 'md:grid-cols-3 xl:grid-cols-5')}>{filterFields}</div>

          {filtered && (
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

        <div aria-busy={loading}>
          {error && (
            <div className="p-4 sm:p-6">
              <Alert
                title="The list could not be loaded"
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
              title={filtered ? 'Nobody matches' : mode === 'in' ? 'Nobody has checked in yet' : 'Nobody has checked out yet'}
              action={
                filtered && (
                  <Button variant="secondary" onClick={resetFilters}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> Reset search and filters
                  </Button>
                )
              }
            >
              {filtered ? 'Try a different search term or remove some filters.' : 'People appear here as soon as their pass is scanned.'}
            </EmptyState>
          )}

          {!error && data && data.items.length > 0 && (
            <div className={cx('transition-opacity duration-200', loading && 'opacity-80')}>
              {/* Cards on phones and tablets */}
              <ul className="grid grid-cols-1 gap-3 bg-slate-50/60 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 lg:hidden">
                {data.items.map((r) => {
                  const undoable = undoAction(r);
                  return (
                    <li key={r.id} className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-panel">
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
                          <p className="truncate text-xs text-slate-500">{[r.district, r.area, r.unit].filter(Boolean).join(' · ')}</p>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-[13px]">
                        <div className="min-w-0">
                          <dt className="text-xs font-semibold text-slate-500">Checked in</dt>
                          <dd>{timeCell(r.checkedInAt, r.checkedInByName)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-semibold text-slate-500">Checked out</dt>
                          <dd>{timeCell(r.checkedOutAt, r.checkedOutByName)}</dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex gap-2">
                        <Link
                          to={`/admin/registrations/${r.id}`}
                          state={back}
                          className="btn-line inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"
                        >
                          <Eye className="h-4 w-4" aria-hidden /> Details
                        </Link>
                        {undoable && (
                          <Button variant="secondary" onClick={() => askUndo(undoable)} className="flex-1 text-[13px]">
                            <Undo2 className="h-4 w-4" aria-hidden /> Undo {copy.noun}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Table on desktops */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full table-auto text-left text-sm">
                  <thead className="border-b border-slate-200/70 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="w-0 py-3 pl-6 pr-2 text-right">
                        #
                      </th>
                      <SortHeader<SortKey> label="Person" sortKey="name" sort={sort} dir={dir} onSort={onSort} />
                      <SortHeader<SortKey> label="Age" sortKey="age" sort={sort} dir={dir} onSort={onSort} className="hidden xl:table-cell" />
                      <SortHeader<SortKey> label="District" sortKey="district" sort={sort} dir={dir} onSort={onSort} />
                      {mode === 'in' ? (
                        <>
                          <SortHeader<SortKey> label="Checked in" sortKey="time" sort={sort} dir={dir} onSort={onSort} />
                          <th scope="col" className="px-3 py-3">
                            Checked out
                          </th>
                        </>
                      ) : (
                        <>
                          <th scope="col" className="px-3 py-3">
                            Checked in
                          </th>
                          <SortHeader<SortKey> label="Checked out" sortKey="time" sort={sort} dir={dir} onSort={onSort} />
                        </>
                      )}
                      <th scope="col" className="py-3 pl-3 pr-6 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((r, i) => {
                      const undoable = undoAction(r);
                      return (
                        <tr key={r.id} className="transition-colors hover:bg-brand-50/40">
                          <td className="py-3.5 pl-6 pr-2 text-right tabular-nums text-slate-400">{first + i}</td>
                          <td className="px-3 py-3.5">
                            <div className="flex items-center gap-3">
                              <Avatar name={r.name} src={r.photoUrl} className="h-10 w-10 text-xs" />
                              <div className="min-w-0">
                                <Link
                                  to={`/admin/registrations/${r.id}`}
                                  state={back}
                                  className="block max-w-[12rem] truncate font-semibold text-slate-900 hover:text-brand-700"
                                >
                                  {r.name}
                                </Link>
                                <div className="text-xs text-slate-500">
                                  <span className="font-mono">{r.regNo}</span> · {r.mobileDisplay}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-3 py-3.5 tabular-nums text-slate-700 xl:table-cell">{r.age}</td>
                          <td className="px-3 py-3.5">
                            <div className="font-medium text-slate-800">{r.district}</div>
                            {(r.area || r.unit || Boolean(r.childrenCount)) && (
                              <div className="max-w-[9rem] truncate text-xs text-slate-500 xl:max-w-[12rem]">
                                {[r.area, r.unit, r.childrenCount ? childrenLabel(r.childrenCount) : ''].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3.5">{timeCell(r.checkedInAt, r.checkedInByName)}</td>
                          <td className="px-3 py-3.5">{timeCell(r.checkedOutAt, r.checkedOutByName)}</td>
                          <td className="py-3.5 pl-3 pr-6">
                            <div className="flex items-center justify-end gap-1">
                              {undoable && (
                                <button
                                  type="button"
                                  onClick={() => askUndo(undoable)}
                                  title={`Undo the ${copy.noun}`}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-amber-50 hover:text-amber-700"
                                >
                                  <Undo2 className="h-4 w-4" aria-hidden />
                                  <span className="sr-only">
                                    Undo the {copy.noun} of {r.name}
                                  </span>
                                </button>
                              )}
                              <Link
                                to={`/admin/registrations/${r.id}`}
                                state={back}
                                title="View details"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-brand-50 hover:text-brand-700"
                              >
                                <Eye className="h-4 w-4" aria-hidden />
                                <span className="sr-only">View details of {r.name}</span>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
        description={data ? `${data.total} ${data.total === 1 ? 'person matches' : 'people match'}` : undefined}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{filterFields}</div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(undoing)}
        title={undoing ? `Undo the ${undoing.action === 'in' ? 'check-in' : 'check-out'} of ${undoing.r.name}?` : ''}
        icon={
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
            <Undo2 className="h-5 w-5" aria-hidden />
          </span>
        }
        onClose={() => !undoBusy && setUndoing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUndoing(null)} disabled={undoBusy} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" loading={undoBusy} onClick={confirmUndo}>
              Undo {undoing?.action === 'in' ? 'check-in' : 'check-out'}
            </Button>
          </>
        }
      >
        {undoing && (
          <p>
            The {undoing.action === 'in' ? 'check-in' : 'check-out'} at{' '}
            <strong>{formatScanTime(undoing.action === 'in' ? undoing.r.checkedInAt : undoing.r.checkedOutAt)}</strong> is removed and the QR code can be
            scanned again. Use this only for a pass scanned by mistake.
          </p>
        )}
      </Dialog>

      <ExportDialog
        open={exporting}
        onClose={() => setExporting(false)}
        query={query}
        total={data?.total ?? 0}
        filtered={filtered}
        path="/api/admin/attendance/export"
        noun={copy.noun}
      />
    </main>
  );
}
