import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, Copy, Download, Share2, UserRound } from 'lucide-react';
import '../site.css';
import { api, ApiError, errorMessage, newIdempotencyKey, uploadFile } from '../lib/api';
import type { PublicConfig, PublicPage, PublicSite, SubmissionResult } from '../lib/types';
import { FALLBACK_SITE, plain, socialLinks } from '../lib/site';
import { COMMON_COUNTRIES, COUNTRIES, findCountry, lengthText } from '../lib/phone';
import {
  FIELD_ORDER,
  childAgeError,
  childNameError,
  childrenCountError,
  instantError,
  matchDistrict,
  validateAll,
  validateField,
} from '../lib/validation';
import type { Child, Errors, FieldKey, FormValues, Rules } from '../lib/validation';
import { Button, Dialog, cx } from '../components/ui';
import { BackToTop, SiteHeader } from '../components/SiteChrome';

const EMPTY: FormValues = { name: '', age: '', gender: '', place: '', district: '', area: '', unit: '', mobile: '', whatsapp: '', email: '' };

const ADULTS_NOTE = 'Any accompanying adults must register separately.';

type Success = SubmissionResult & { eventName: string };

// The uploaded photo: `key` goes with the submission, `preview` is a local object URL.
type Photo = { key: string; preview: string };

const PHOTO_EDGE = 1200;
const PHOTO_MIN_SIDE = 200;

/**
 * Reads the chosen file as an image and re-encodes it as a JPEG with the long
 * side at most PHOTO_EDGE. Browsers draw phone photos upright (EXIF
 * orientation), and the upload stays small on mobile data. The server checks
 * and re-encodes it again.
 */
async function preparePhoto(file: File): Promise<Blob> {
  if (file.size > 25 * 1024 * 1024) throw new Error('This photo is too large. Choose one under 25 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('This file could not be read as a photo. Choose a JPG or PNG photo.');
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < PHOTO_MIN_SIDE || h < PHOTO_MIN_SIDE) throw new Error(`This photo is too small. Use one at least ${PHOTO_MIN_SIDE} pixels wide and high.`);
    const scale = Math.min(1, PHOTO_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the photo. Try another browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser could not prepare the photo. Try another browser.'))), 'image/jpeg', 0.9)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Register() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [page, setPage] = useState<PublicPage>(FALLBACK_SITE.page);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [sameAsMobile, setSameAsMobile] = useState(true);
  // '' until changed: the event's default country (config.defaultCountry) applies.
  const [mobileCountry, setMobileCountry] = useState('');
  const [whatsappCountry, setWhatsappCountry] = useState('');
  // As typed; one name and age row is shown per child.
  const [childrenCount, setChildrenCount] = useState('');
  const [children, setChildren] = useState<Child[]>([]);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  // Only the latest chosen photo counts when two uploads overlap.
  const photoRequest = useRef(0);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState<Success | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // One key per filled-in form: a double tap or a retry after a network
  // error is recognised by the server as the same submission.
  const idempotencyKey = useRef(newIdempotencyKey());
  const honeypot = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const loadConfig = () => {
    setConfigError('');
    api<PublicConfig>('/api/public/config')
      .then((c) => {
        setConfig(c);
        document.title = `Register · ${c.eventName}`;
      })
      .catch((err) => setConfigError(errorMessage(err)));
  };
  useEffect(loadConfig, []);
  useEffect(() => {
    api<PublicSite>('/api/public/site')
      .then((s) => setPage(s.page))
      .catch(() => {});
  }, []);

  const defaultCountry = config?.defaultCountry ?? 'IN';
  const mc = mobileCountry || defaultCountry;
  const wc = sameAsMobile ? mc : whatsappCountry || defaultCountry;
  const rules: Rules = {
    ageMin: config?.ageMin ?? 10,
    ageMax: config?.ageMax ?? 100,
    districts: config?.districts ?? [],
    mobileCountry: mc,
    whatsappCountry: wc,
    genderOptions: config?.genderOptions ?? [],
    placeRequired: config?.placeRequired ?? true,
    children: config?.children ?? { max: 10, ageMin: 0, ageMax: 17 },
    sameAsMobile,
  };
  const required: Record<FieldKey, boolean> = {
    name: true,
    age: true,
    gender: true,
    place: rules.placeRequired,
    district: true,
    area: false,
    unit: false,
    mobile: true,
    whatsapp: true,
    email: true,
  };

  const shown = (k: string) => touched[k] || submitAttempted;
  const errorFor = (k: FieldKey) =>
    serverErrors[k] || (shown(k) ? validateField(k, values[k], rules) : instantError(k, values[k])) || undefined;
  const childErrorFor = (i: number, f: 'name' | 'age') => {
    const k = `children.${i}.${f}` as const;
    if (serverErrors[k]) return serverErrors[k];
    if (!shown(k)) return undefined;
    return f === 'name' ? childNameError(children[i]?.name ?? '') : childAgeError(children[i]?.age ?? '', rules);
  };
  const dirty =
    FIELD_ORDER.some((k) => values[k].trim() !== '') ||
    childrenCount.trim() !== '' ||
    !sameAsMobile ||
    mobileCountry !== '' ||
    whatsappCountry !== '' ||
    photo !== null;
  const photoErr = serverErrors.photo || photoError || (submitAttempted && !photo && !photoBusy ? 'Please add your photo' : undefined);

  const clearServer = (k: string) => {
    setServerErrors((s) => ({ ...s, [k]: undefined }));
    setFormError('');
  };
  const set = (k: FieldKey, v: string) => {
    setValues((all) => ({ ...all, [k]: v }));
    clearServer(k);
  };
  const update = (k: FieldKey) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value);
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  // Rows follow the typed number while it is valid; what was typed in a row is
  // kept when the number goes down and up again.
  function setCount(raw: string) {
    setChildrenCount(raw);
    if (!childrenCountError(raw, rules)) {
      const n = raw.trim() ? Number(raw) : 0;
      setChildren((all) => Array.from({ length: n }, (_, i) => all[i] ?? { name: '', age: '' }));
    }
    clearServer('childrenCount');
  }

  function clearPhoto() {
    photoRequest.current += 1;
    setPhoto((p) => {
      if (p) URL.revokeObjectURL(p.preview);
      return null;
    });
    setPhotoBusy(false);
    setPhotoError('');
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    const request = ++photoRequest.current;
    clearServer('photo');
    setPhotoError('');
    setPhotoBusy(true);
    try {
      const blob = await preparePhoto(file);
      const res = await uploadFile<{ photo: string }>('/api/public/photos', blob, file.name);
      if (request !== photoRequest.current) return;
      setPhoto((p) => {
        if (p) URL.revokeObjectURL(p.preview);
        return { key: res.photo, preview: URL.createObjectURL(blob) };
      });
    } catch (err) {
      if (request !== photoRequest.current) return;
      setPhotoError(err instanceof ApiError ? err.message : (err as Error).message || 'The photo could not be uploaded. Please try again.');
    } finally {
      if (request === photoRequest.current) setPhotoBusy(false);
    }
  }

  function setChild(i: number, f: keyof Child, v: string) {
    setChildren((all) => all.map((c, j) => (j === i ? { ...c, [f]: v } : c)));
    clearServer(`children.${i}.${f}`);
  }

  function reset() {
    setValues(EMPTY);
    setSameAsMobile(true);
    setMobileCountry('');
    setWhatsappCountry('');
    setChildrenCount('');
    setChildren([]);
    clearPhoto();
    setTouched({});
    setSubmitAttempted(false);
    setServerErrors({});
    setFormError('');
    idempotencyKey.current = newIdempotencyKey();
  }

  function focusFirst(errs: Errors) {
    const order = [
      ...FIELD_ORDER.flatMap((k) =>
        k === 'gender' ? [k, 'photo'] : k === 'mobile' ? ['mobileCountry', k] : k === 'whatsapp' ? ['whatsappCountry', k] : [k]
      ),
      'childrenCount',
      ...children.flatMap((_, i) => [`children.${i}.name`, `children.${i}.age`]),
    ];
    const first = order.find((k) => errs[k as keyof Errors]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !config) return;
    setSubmitAttempted(true);
    setFormError('');
    if (photoBusy) {
      setFormError('Please wait until your photo has finished uploading.');
      return;
    }
    const errs = validateAll(values, childrenCount, children, rules);
    if (!photo) errs.photo = 'Please add your photo';
    if (Object.keys(errs).length) {
      focusFirst(errs);
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        formVersion: config.formVersion,
        name: values.name.trim(),
        age: values.age.trim(),
        ...(rules.genderOptions.length ? { gender: values.gender } : {}),
        photo: photo?.key,
        place: values.place.trim(),
        district: matchDistrict(values.district, rules.districts) ?? values.district.trim(),
        // Optional; sent empty when left blank.
        area: values.area.trim(),
        unit: values.unit.trim(),
        mobileCountry: mc,
        mobile: values.mobile.trim(),
        whatsappSameAsMobile: sameAsMobile,
        whatsappCountry: wc,
        ...(sameAsMobile ? {} : { whatsapp: values.whatsapp.trim() }),
        email: values.email.trim(),
        childrenCount: children.length,
        children: children.map((c) => ({ name: c.name.trim(), age: c.age.trim() })),
        ...(honeypot.current?.value ? { website: honeypot.current.value } : {}),
      };
      const res = await api<SubmissionResult>('/api/public/registrations', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey.current },
      });
      setSuccess({ ...res, eventName: plain(config.eventName) });
      reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'form_outdated') {
        setFormError('This form was updated. Please reload the page; what you typed will need to be entered again.');
      } else {
        if (err instanceof ApiError && err.fields) {
          setServerErrors(err.fields as Errors);
          focusFirst(err.fields as Errors);
        }
        setFormError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  type Aria = { id: string; name: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; 'aria-required'?: boolean };
  const fld = (k: FieldKey, label: string, input: (aria: Aria) => JSX.Element, extraError?: string) => {
    const err = extraError || errorFor(k);
    return (
      <div className="fld">
        <label htmlFor={`r-${k}`}>
          {label}
          {required[k] && <Req />}
        </label>
        {input({
          id: `r-${k}`,
          name: k,
          'aria-invalid': err ? true : undefined,
          'aria-describedby': err ? `r-${k}-err` : undefined,
          'aria-required': required[k] || undefined,
        })}
        {err && (
          <p className="err" id={`r-${k}-err`}>
            {err}
          </p>
        )}
      </div>
    );
  };

  const text = (k: FieldKey, extra: Record<string, unknown> = {}) =>
    fld(k, LABELS[k], (aria) => <input {...aria} className="ctl" value={values[k]} onChange={update(k)} onBlur={blur(k)} {...extra} />);

  const genderErr = errorFor('gender');
  const countErr = serverErrors.childrenCount || childrenCountError(childrenCount, rules);
  const mobileC = findCountry(mc);
  const whatsappC = findCountry(wc);
  const eventLine = [config?.eventDate, config?.eventVenue].filter(Boolean).join(' · ');

  return (
    <div className="site">
      <SiteHeader
        socials={socialLinks(page)}
        actions={
          <Link to="/" className="hdr-back">
            <span aria-hidden="true">←</span> Conference home
          </Link>
        }
      />

      <div className="reg-top">
        <div className="wrap">
          <p className="eyebrow">{config ? plain(config.eventName) : plain(page.title)}</p>
          <h1>Registration</h1>
          {eventLine && (
            <p className="event">
              {[config?.eventDate, config?.eventVenue].filter(Boolean).map((v) => (
                <span key={v}>{v}</span>
              ))}
            </p>
          )}
        </div>
      </div>

      <main className="wrap reg-layout">
        <div>
          <div className="fpaper">
            {!config && !configError && (
              <div aria-busy="true" style={{ display: 'grid', gap: 16 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="sk" style={{ height: 50 }} />
                ))}
                <span className="sr-only" role="status">
                  Loading the form…
                </span>
              </div>
            )}

            {configError && (
              <div role="alert">
                <p className="form-alert">The form could not be loaded. {configError}</p>
                <p style={{ marginTop: 16 }}>
                  <button type="button" className="btn-clear" onClick={loadConfig}>
                    Try again
                  </button>
                </p>
              </div>
            )}

            {config && success && <SuccessPanel success={success} onAgain={() => setSuccess(null)} />}

            {config && !success && !config.registrationOpen && (
              <div className="closed" role="status">
                <h2>Registrations are closed</h2>
                <p>Registration for this event is not open at the moment.</p>
              </div>
            )}

            {config && !success && config.registrationOpen && (
              <form ref={formRef} onSubmit={onSubmit} noValidate className="reg-form">
                <p className="req-note">
                  Fields marked <Req /> are required.
                </p>
                <fieldset className="fsec">
                  <legend>About you</legend>
                  {text('name', { autoComplete: 'name', autoCapitalize: 'words', placeholder: 'Your full name', maxLength: 120 })}
                  <div className="grid2 grid-age">
                    {text('age', { inputMode: 'numeric', autoComplete: 'off', placeholder: 'Age', maxLength: 3 })}
                    {rules.genderOptions.length > 0 && (
                      <div className="fld">
                        <span className="lbl" id="r-gender-lbl">
                          Gender
                          <Req />
                        </span>
                        <div
                          className="chips"
                          role="radiogroup"
                          aria-labelledby="r-gender-lbl"
                          aria-required="true"
                          aria-invalid={genderErr ? true : undefined}
                          aria-describedby={genderErr ? 'r-gender-err' : undefined}
                        >
                          {rules.genderOptions.map((g) => (
                            <label key={g} className="chip">
                              <input
                                type="radio"
                                name="gender"
                                value={g}
                                checked={values.gender === g}
                                onChange={() => {
                                  set('gender', g);
                                  blur('gender')();
                                }}
                              />
                              <span>{g}</span>
                            </label>
                          ))}
                        </div>
                        {genderErr && (
                          <p className="err" id="r-gender-err">
                            {genderErr}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </fieldset>

                <fieldset className="fsec">
                  <legend>Photo</legend>
                  <div className="photo-fld">
                    <div className={cx('photo-box', photoErr && 'photo-box-err')}>
                      {photo ? <img src={photo.preview} alt="Your photo" /> : <UserRound aria-hidden strokeWidth={1.4} />}
                      {photoBusy && (
                        <span className="photo-busy">
                          <span className="spin" aria-hidden />
                        </span>
                      )}
                    </div>
                    <div className="photo-side">
                      <span className="lbl" id="r-photo-lbl">
                        Your photo
                        <Req />
                      </span>
                      <p className="hint" id="r-photo-hint">
                        A clear, recent photo of your face. It is printed on your entry pass.
                      </p>
                      <div className="photo-actions">
                        <label className="btn-clear photo-btn">
                          <input
                            type="file"
                            name="photo"
                            accept="image/*"
                            className="sr-only"
                            aria-labelledby="r-photo-lbl"
                            aria-describedby={photoErr ? 'r-photo-err' : 'r-photo-hint'}
                            aria-invalid={photoErr ? true : undefined}
                            aria-required="true"
                            disabled={photoBusy}
                            onChange={(e) => {
                              void choosePhoto(e.target.files?.[0]);
                              e.target.value = ''; // choosing the same file again still triggers a change
                            }}
                          />
                          <Camera size={18} aria-hidden /> {photo ? 'Change photo' : 'Choose photo'}
                        </label>
                        {photo && !photoBusy && (
                          <button type="button" className="photo-remove" onClick={clearPhoto}>
                            Remove
                          </button>
                        )}
                      </div>
                      {photoBusy && (
                        <p className="hint" role="status">
                          Uploading your photo…
                        </p>
                      )}
                      {photoErr && !photoBusy && (
                        <p className="err" id="r-photo-err">
                          {photoErr}
                        </p>
                      )}
                    </div>
                  </div>
                </fieldset>

                <fieldset className="fsec">
                  <legend>Location</legend>
                  <div className="grid2">
                    {text('place', { autoCapitalize: 'words', autoComplete: 'address-level2', placeholder: 'Your place', maxLength: 100 })}
                    {fld('district', 'District', (aria) => (
                      <select {...aria} className="ctl" value={matchDistrict(values.district, rules.districts) ?? ''} onChange={update('district')} onBlur={blur('district')}>
                        <option value="">Select district</option>
                        {rules.districts.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                  <div className="grid2">
                    {text('area', { autoCapitalize: 'words', autoComplete: 'off', placeholder: 'Your area', maxLength: 100 })}
                    {text('unit', { autoCapitalize: 'words', autoComplete: 'off', placeholder: 'Your unit', maxLength: 100 })}
                  </div>
                </fieldset>

                <fieldset className="fsec">
                  <legend>Contact</legend>
                  <div className="grid2">
                    {fld(
                      'mobile',
                      LABELS.mobile,
                      (aria) => (
                        <div className="tel">
                          <CountrySelect
                            id="r-mobileCountry"
                            name="mobileCountry"
                            label="Country code for phone number"
                            value={mc}
                            invalid={Boolean(serverErrors.mobileCountry)}
                            onChange={(v) => {
                              setMobileCountry(v);
                              clearServer('mobileCountry');
                              clearServer('mobile');
                            }}
                          />
                          <input
                            {...aria}
                            className="ctl"
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="tel-national"
                            placeholder={mobileC ? `${lengthText(mobileC.lengths)}-digit mobile number` : 'Mobile number'}
                            maxLength={mobileC ? Math.max(...mobileC.lengths) : 15}
                            value={values.mobile}
                            onChange={update('mobile')}
                            onBlur={blur('mobile')}
                          />
                        </div>
                      ),
                      serverErrors.mobileCountry
                    )}
                    {fld(
                      'whatsapp',
                      LABELS.whatsapp,
                      (aria) => (
                        <>
                          <div className="tel">
                            <CountrySelect
                              id="r-whatsappCountry"
                              name="whatsappCountry"
                              label="Country code for WhatsApp number"
                              value={wc}
                              disabled={sameAsMobile}
                              invalid={Boolean(serverErrors.whatsappCountry)}
                              onChange={(v) => {
                                setWhatsappCountry(v);
                                clearServer('whatsappCountry');
                                clearServer('whatsapp');
                              }}
                            />
                            <input
                              {...aria}
                              className="ctl"
                              type="tel"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              placeholder={whatsappC ? `${lengthText(whatsappC.lengths)}-digit WhatsApp number` : 'WhatsApp number'}
                              maxLength={whatsappC ? Math.max(...whatsappC.lengths) : 15}
                              disabled={sameAsMobile}
                              value={sameAsMobile ? values.mobile : values.whatsapp}
                              onChange={update('whatsapp')}
                              onBlur={blur('whatsapp')}
                            />
                          </div>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={sameAsMobile}
                              onChange={(e) => {
                                setSameAsMobile(e.target.checked);
                                // Start the separate number from the phone's country.
                                if (!e.target.checked && !whatsappCountry) setWhatsappCountry(mc);
                                clearServer('whatsapp');
                                clearServer('whatsappCountry');
                              }}
                            />
                            Same as phone number
                          </label>
                        </>
                      ),
                      serverErrors.whatsappCountry
                    )}
                  </div>
                  {text('email', { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false, placeholder: 'name@example.com', maxLength: 200 })}
                </fieldset>

                <fieldset className="fsec">
                  <legend>Accompanying children</legend>
                  <div className="grid2">
                    <div className="fld">
                      <label htmlFor="r-childrenCount">Number of accompanying children</label>
                      <input
                        id="r-childrenCount"
                        name="childrenCount"
                        className="ctl"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        placeholder="0"
                        maxLength={2}
                        value={childrenCount}
                        aria-invalid={countErr ? true : undefined}
                        aria-describedby={countErr ? 'r-childrenCount-err' : 'r-childrenCount-hint'}
                        onChange={(e) => setCount(e.target.value)}
                      />
                      {countErr ? (
                        <p className="err" id="r-childrenCount-err">
                          {countErr}
                        </p>
                      ) : (
                        <p className="hint" id="r-childrenCount-hint">
                          Leave empty or enter 0 if no children are coming. Up to {rules.children.max}.
                        </p>
                      )}
                    </div>
                  </div>
                  {children.length > 0 && (
                    <div className="kids">
                      {children.map((c, i) => (
                        <div className="kid" key={i} role="group" aria-labelledby={`r-child-${i}`}>
                          <p className="kid-h" id={`r-child-${i}`}>
                            Child {i + 1}
                          </p>
                          <div className="kid-row">
                            {(['name', 'age'] as const).map((f) => {
                              const err = childErrorFor(i, f);
                              const id = `r-children-${i}-${f}`;
                              return (
                                <div className="fld" key={f}>
                                  <label htmlFor={id}>
                                    {f === 'name' ? 'Name' : 'Age'}
                                    <Req />
                                  </label>
                                  <input
                                    id={id}
                                    name={`children.${i}.${f}`}
                                    className="ctl"
                                    {...(f === 'name'
                                      ? { autoCapitalize: 'words', placeholder: "Child's name", maxLength: 120 }
                                      : { inputMode: 'numeric' as const, pattern: '[0-9]*', placeholder: 'Age', maxLength: 2 })}
                                    autoComplete="off"
                                    value={c[f]}
                                    aria-required="true"
                                    aria-invalid={err ? true : undefined}
                                    aria-describedby={err ? `${id}-err` : undefined}
                                    onChange={(e) => setChild(i, f, e.target.value)}
                                    onBlur={blur(`children.${i}.${f}`)}
                                  />
                                  {err && (
                                    <p className="err" id={`${id}-err`}>
                                      {err}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="note-adults" role="note">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <circle cx="12" cy="12" r="9.5" />
                      <path d="M12 7.5v5.5M12 16.5v.5" />
                    </svg>
                    <span>{ADULTS_NOTE}</span>
                  </p>
                </fieldset>

                {/* Honeypot for bots: hidden from people and assistive technology. */}
                <div aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 0, height: 0, overflow: 'hidden' }}>
                  <label>
                    Website
                    <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>

                {formError && (
                  <p className="form-alert" role="alert">
                    {formError}
                  </p>
                )}

                <div className="actions">
                  <button type="submit" className="btn-submit" disabled={submitting} aria-busy={submitting || undefined}>
                    {submitting && <span className="spin" aria-hidden />}
                    {submitting ? 'Submitting…' : (
                      <>
                        Submit registration <span aria-hidden="true">→</span>
                      </>
                    )}
                  </button>
                  <button type="button" className="btn-clear" onClick={() => setConfirmClear(true)} disabled={submitting || !dirty}>
                    Clear
                  </button>
                </div>
              </form>
            )}
          </div>
          {config?.supportContact && <p className="help">Need help? Contact {config.supportContact}</p>}
        </div>

        {page.poster && (
          <aside className="reg-aside" aria-label="Conference">
            <img src={page.poster.url} alt={page.poster.alt} width={page.poster.width} height={page.poster.height} loading="lazy" />
            <dl>
              {[
                ['Date', page.dateText],
                ['Location', page.location],
                ['Venue', page.venue],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </aside>
        )}
      </main>
      <BackToTop />

      <Dialog
        open={confirmClear}
        title="Clear the form?"
        description="Everything you have entered will be removed. Nothing has been submitted."
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmClear(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirmClear(false);
              }}
            >
              Clear form
            </Button>
          </>
        }
      />
    </div>
  );
}

const LABELS: Record<FieldKey, string> = {
  name: 'Name',
  age: 'Age',
  gender: 'Gender',
  place: 'Place',
  district: 'District',
  area: 'Area',
  unit: 'Unit',
  mobile: 'Phone number',
  whatsapp: 'WhatsApp number',
  email: 'Email',
};

/** Required-field marker; screen readers get aria-required on the field instead. */
function Req() {
  return (
    <span className="req" aria-hidden="true">
      *
    </span>
  );
}

const flag = (iso: string) => String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

/** Country code picker: shows the flag and code, opens the full list (native select). */
function CountrySelect({
  id,
  name,
  label,
  value,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (iso: string) => void;
}) {
  const c = findCountry(value);
  const option = (o: { iso: string; name: string; dial: string }) => (
    <option key={o.iso} value={o.iso}>
      {o.name} (+{o.dial})
    </option>
  );
  return (
    <span className={cx('cc', disabled && 'cc-off', invalid && 'cc-err')}>
      <span aria-hidden="true">
        {c ? `${flag(c.iso)} +${c.dial}` : 'Code'}
      </span>
      <select id={id} name={name} aria-label={label} aria-invalid={invalid || undefined} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Common">{COMMON_COUNTRIES.map(option)}</optgroup>
        <optgroup label="All countries">{COUNTRIES.map(option)}</optgroup>
      </select>
    </span>
  );
}

function SuccessPanel({ success, onAgain }: { success: Success; onAgain: () => void }) {
  const { pass } = success;
  const fileName = `entry-pass-${pass.passId}.png`;
  const [copied, setCopied] = useState(false);
  const [src, setSrc] = useState(pass.imageUrl);
  const [loaded, setLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');

  // The image is fetched once from this origin, so Download and Share work
  // straight away (sharing must start within the tap, before any download).
  useEffect(() => {
    let live = true;
    fetch(pass.downloadUrl, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => live && setFile(new File([blob], fileName, { type: 'image/png' })))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pass.downloadUrl, fileName]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(success.regNo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available; the number is visible anyway */
    }
  };

  function download() {
    if (!file) {
      // Not fetched (yet): the server sends it as a download.
      window.location.href = pass.downloadUrl;
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function share() {
    setNote('');
    const title = `Entry pass · ${success.eventName}`;
    const text = `${success.name}, registration ${success.regNo}. Entry pass for ${success.eventName}.`;
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
      } else if (typeof navigator.share === 'function') {
        await navigator.share({ title, text, url: pass.imageUrl });
      } else {
        await navigator.clipboard.writeText(pass.imageUrl);
        setNote('Sharing is not available in this browser, so the link to your pass was copied. Paste it into any app to share it.');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // closed the share sheet
      setNote(`Sharing did not work here. Download the pass instead, or share this link: ${pass.imageUrl}`);
    }
  }

  return (
    <div className="success" role="status">
      <span className="tick">
        <Check size={28} strokeWidth={3} aria-hidden />
      </span>
      <h2>Registration complete</h2>
      <p>Thank you, {success.name}. Your entry pass is ready. Show its QR code at the entrance.</p>
      <span className="regno">
        {success.regNo}
        <button type="button" onClick={copy} aria-label="Copy registration number">
          {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
        </button>
      </span>

      <figure className="pass-card">
        {!loaded && <span className="sk pass-sk" aria-hidden="true" />}
        <img
          className="pass-img"
          src={src}
          alt={`Entry pass for ${success.name}, pass ID ${pass.passId}`}
          hidden={!loaded}
          onLoad={() => setLoaded(true)}
          // CDN not reachable: show the copy from this server instead.
          onError={() => src !== pass.downloadUrl && setSrc(pass.downloadUrl)}
        />
        <figcaption>Pass ID {pass.passId}</figcaption>
      </figure>

      <div className="pass-actions">
        <button type="button" className="btn-submit" onClick={download}>
          <Download size={18} aria-hidden /> Download pass
        </button>
        <button type="button" className="btn-clear" onClick={share}>
          <Share2 size={18} aria-hidden /> Share pass
        </button>
      </div>
      {note && <p className="pass-note">{note}</p>}
      <p className="pass-note">Keep the pass on your phone or print it. It is valid only with its QR code.</p>

      <p className="again">
        <button type="button" className="btn-clear" onClick={onAgain}>
          Register another person
        </button>
        <Link to="/" className="btn-clear">
          Back to the conference page
        </Link>
      </p>
    </div>
  );
}
