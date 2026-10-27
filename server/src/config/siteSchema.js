// Shape and validation of the conference website content.
//
// The page settings are one document (title, theme, venue, contact, section
// switches, registration form rules). Programme items, speakers,
// announcements, FAQs and gallery images are separate items. Both keep a
// draft and a published copy; the public website only ever reads the
// published copy.
//
// Text is stored as plain text. `*word*` marks emphasis in headings; the
// client renders it as <em> without ever interpreting HTML.
const { z } = require('zod');
const { FORM_RULE_LIMITS, CHILDREN_DEFAULTS } = require('./constants');

const ASSET_ID = /^[a-f0-9]{24}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (max) => z.string().max(max, `Must be at most ${max} characters`).transform((s) => s.replace(/\r\n/g, '\n').trim());
const line = (max) => z.string().max(max, `Must be at most ${max} characters`).transform((s) => s.replace(/\s+/g, ' ').trim());
const assetRef = z.union([z.literal(''), z.string().regex(ASSET_ID, 'Invalid image')]);

// http(s) only: no javascript:, data: or other schemes reach an href.
const webUrl = z.union([
  z.literal(''),
  z
    .string()
    .trim()
    .max(500)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        return false;
      }
    }, 'Enter a full web address starting with https://'),
]);

// Announcement links may also point at the registration form.
const linkUrl = z.union([z.literal('/register'), webUrl]);

const SECTIONS = ['updates', 'theme', 'about', 'programme', 'speakers', 'gallery', 'faq', 'venue', 'contact'];

const formRules = z
  .object({
    genderOptions: z
      .array(line(30).pipe(z.string().min(1, 'Option cannot be empty')))
      .max(FORM_RULE_LIMITS.genderOptionsMax, `At most ${FORM_RULE_LIMITS.genderOptionsMax} options`)
      .refine((a) => new Set(a.map((s) => s.toLowerCase())).size === a.length, 'Options must be different'),
    childrenMax: z.number().int().min(1).max(FORM_RULE_LIMITS.childrenMax).nullable(),
    childAgeMin: z.number().int().min(0).max(FORM_RULE_LIMITS.childAgeMax).nullable(),
    childAgeMax: z.number().int().min(0).max(FORM_RULE_LIMITS.childAgeMax).nullable(),
  })
  .strict()
  .superRefine((f, ctx) => {
    const set = [f.childrenMax, f.childAgeMin, f.childAgeMax].filter((v) => v !== null).length;
    if (set !== 0 && set !== 3) {
      ctx.addIssue({ code: 'custom', path: ['childrenMax'], message: 'Set the maximum number of children and both age limits, or leave all three empty' });
    }
    if (set === 3 && f.childAgeMin > f.childAgeMax) {
      ctx.addIssue({ code: 'custom', path: ['childAgeMin'], message: 'Minimum age must not be above the maximum age' });
    }
  });

const pageSettings = z
  .object({
    presenter: line(120),
    title: line(160).pipe(z.string().min(1, 'Title is required')),
    intro: text(1500),
    dateText: line(80),
    location: line(120),
    venue: line(160),
    venueAddress: text(600),
    mapUrl: webUrl,
    themeShort: line(120),
    themeTitle: line(200),
    themeSubtitle: line(200),
    themeBody: text(5000),
    aboutHeading: line(160),
    aboutBody: text(6000),
    aboutImage: assetRef,
    logo: assetRef,
    poster: assetRef,
    posterCaption: line(120),
    posterTag: line(60),
    updatesHeading: line(160),
    programmeHeading: line(160),
    programmeIntro: text(1500),
    speakersHeading: line(160),
    galleryHeading: line(160),
    faqHeading: line(160),
    regHeading: line(200),
    regNote: text(800),
    phone: line(40),
    whatsapp: line(40),
    email: z.union([z.literal(''), z.string().trim().max(200).email('Enter a valid email address')]),
    facebook: webUrl,
    instagram: webUrl,
    youtube: webUrl,
    closingText: line(200),
    footerText: line(200),
    show: z.object(Object.fromEntries(SECTIONS.map((k) => [k, z.boolean()]))).strict(),
    registrationOpen: z.boolean(),
    form: formRules,
  })
  .strict();

const EMPTY_PAGE = Object.freeze({
  presenter: '',
  title: 'Conference',
  intro: '',
  dateText: '',
  location: '',
  venue: '',
  venueAddress: '',
  mapUrl: '',
  themeShort: '',
  themeTitle: '',
  themeSubtitle: '',
  themeBody: '',
  aboutHeading: 'About the conference',
  aboutBody: '',
  aboutImage: '',
  logo: '',
  poster: '',
  posterCaption: '',
  posterTag: '',
  updatesHeading: 'Latest updates',
  programmeHeading: 'Programme',
  programmeIntro: '',
  speakersHeading: 'Speakers',
  galleryHeading: 'Gallery',
  faqHeading: 'Questions',
  regHeading: 'Register once. Get your entry pass instantly.',
  regNote: '',
  phone: '',
  whatsapp: '',
  email: '',
  facebook: '',
  instagram: '',
  youtube: '',
  closingText: '',
  footerText: '',
  show: Object.fromEntries(SECTIONS.map((k) => [k, true])),
  registrationOpen: true,
  form: { genderOptions: [], childrenMax: null, childAgeMin: null, childAgeMax: null },
});

const ITEM_SCHEMAS = {
  programme: z
    .object({
      type: z.enum(['session', 'break']),
      title: line(200).pipe(z.string().min(1, 'Title is required')),
      start: z.union([z.literal(''), z.string().regex(TIME, 'Use a 24-hour time such as 09:30')]),
      end: z.union([z.literal(''), z.string().regex(TIME, 'Use a 24-hour time such as 10:15')]),
      stage: line(120),
      speakerIds: z.array(z.string().regex(ASSET_ID, 'Invalid speaker')).max(10),
      description: text(1500),
    })
    .strict()
    .refine((p) => !p.start || !p.end || p.end > p.start, { path: ['end'], message: 'End time must be after the start time' }),
  speaker: z
    .object({
      name: line(120).pipe(z.string().min(1, 'Name is required')),
      role: line(200),
      photo: assetRef,
      bio: text(3000),
    })
    .strict(),
  announcement: z
    .object({
      title: line(160).pipe(z.string().min(1, 'Title is required')),
      body: text(1000),
      linkText: line(60),
      linkUrl,
      pinned: z.boolean(),
    })
    .strict()
    .refine((a) => Boolean(a.linkText) === Boolean(a.linkUrl), { path: ['linkUrl'], message: 'Give both the link text and the link, or neither' }),
  faq: z
    .object({
      question: line(300).pipe(z.string().min(1, 'Question is required')),
      answer: text(3000).pipe(z.string().min(1, 'Answer is required')),
    })
    .strict(),
  gallery: z
    .object({
      image: z.string().regex(ASSET_ID, 'Choose an image'),
      caption: line(300),
    })
    .strict(),
};

const ITEM_KINDS = Object.keys(ITEM_SCHEMAS);

const EMPTY_ITEMS = {
  programme: { type: 'session', title: '', start: '', end: '', stage: '', speakerIds: [], description: '' },
  speaker: { name: '', role: '', photo: '', bio: '' },
  announcement: { title: '', body: '', linkText: '', linkUrl: '', pinned: false },
  faq: { question: '', answer: '' },
  gallery: { image: '', caption: '' },
};

// Fields that hold image references, used to find where an image is in use.
const ASSET_FIELDS = {
  page: ['logo', 'poster', 'aboutImage'],
  programme: [],
  speaker: ['photo'],
  announcement: [],
  faq: [],
  gallery: ['image'],
};

/** Plain text of a heading with `*emphasis*` marks removed. */
const plain = (s) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/**
 * Limits for the accompanying children question: the admin-set rules when all
 * three are set, otherwise CHILDREN_DEFAULTS. The question is always asked.
 */
function childrenRules(form) {
  if (form && form.childrenMax && form.childAgeMin !== null && form.childAgeMax !== null) {
    return { max: form.childrenMax, ageMin: form.childAgeMin, ageMax: form.childAgeMax };
  }
  return { ...CHILDREN_DEFAULTS };
}

module.exports = {
  pageSettings,
  formRules,
  ITEM_SCHEMAS,
  ITEM_KINDS,
  EMPTY_PAGE,
  EMPTY_ITEMS,
  ASSET_FIELDS,
  SECTIONS,
  plain,
  childrenRules,
};
