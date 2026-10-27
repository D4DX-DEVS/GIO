// Registration workflow: Submitted -> Confirmed. The entry pass steps
// (generated, sent) are tracked separately in PassStatus.
export type Status = 'submitted' | 'confirmed';
export type PassStatus = 'not_generated' | 'generated' | 'sent' | 'send_failed';
export type Role = 'admin' | 'staff';
export type Permission = 'view' | 'approve' | 'send' | 'gate' | 'content';

export type AdminProfile = { id: string; username: string; name: string; role: Role; permissions: Permission[] };

export type PublicConfig = {
  eventName: string;
  eventDate: string;
  eventVenue: string;
  supportContact: string;
  registrationOpen: boolean;
  ageMin: number;
  ageMax: number;
  districts: string[];
  defaultCountryCode: string;
  countries: Array<{ dial: string; iso: string; name: string; lengths: number[]; starts: string }>;
  formVersion: number;
  placeRequired: boolean;
  // Empty / null until an admin sets them; the form then leaves the question out.
  genderOptions: string[];
  children: { max: number; ageMin: number; ageMax: number } | null;
};

export type RegistrationItem = {
  id: string;
  regNo: string;
  name: string;
  age: number;
  mobile: string;
  mobileDisplay: string;
  email: string;
  district: string;
  area: string;
  unit: string;
  // From the new form; null = not recorded (older registrations).
  formVersion: number;
  gender: string | null;
  place: string | null;
  whatsapp: string | null;
  whatsappDisplay: string | null;
  messagesTo: string;
  childrenCount: number | null;
  status: Status;
  statusChangedAt: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
  passId: string | null;
  passStatus: PassStatus;
  passGeneratedAt: string | null;
  passSentAt: string | null;
  createdAt: string;
};

export type HistoryEntry = { from: Status | null; to: Status; byName: string; note: string; at: string };

export type PassInfo = {
  passId: string;
  version: number;
  status: 'active' | 'revoked';
  issuedAt: string;
  imageUrl: string | null;
};

export type NotificationInfo = {
  id: string;
  template: string;
  status: 'sending' | 'accepted' | 'failed';
  attempts: number;
  lastError: string | null;
  triggeredByName: string;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Permissions = { approve: boolean; send: boolean; gate: boolean };

export type MessageResult = { ok: boolean; duplicate: boolean; error: string | null; template: string | null };

export type RegistrationDetail = {
  registration: RegistrationItem & { statusHistory: HistoryEntry[]; updatedAt: string; childAges: number[] | null };
  pass: PassInfo | null;
  notifications: NotificationInfo[];
  permissions: Permissions;
  messages?: MessageResult[];
  passError?: string | null;
};

export type ListResponse = { items: RegistrationItem[]; total: number; page: number; limit: number; pages: number };

export type Stats = {
  total: number;
  awaitingConfirmation: number;
  confirmed: number;
  passesSent: number;
  passSendFailed: number;
  byStatus: Record<Status, number>;
  byPassStatus: Record<PassStatus, number>;
  failedMessages: number;
};

export type FilterOptions = { districts: string[]; areas: string[]; units: string[] };

// --- Conference website ------------------------------------------------------

export type SectionKey = 'updates' | 'theme' | 'about' | 'programme' | 'speakers' | 'gallery' | 'faq' | 'venue' | 'contact';

export type FormRules = { genderOptions: string[]; childrenMax: number | null; childAgeMin: number | null; childAgeMax: number | null };

export type PageSettings = {
  presenter: string;
  title: string;
  intro: string;
  dateText: string;
  location: string;
  venue: string;
  venueAddress: string;
  mapUrl: string;
  themeShort: string;
  themeTitle: string;
  themeSubtitle: string;
  themeBody: string;
  aboutHeading: string;
  aboutBody: string;
  aboutImage: string;
  logo: string;
  poster: string;
  posterCaption: string;
  posterTag: string;
  updatesHeading: string;
  programmeHeading: string;
  programmeIntro: string;
  speakersHeading: string;
  galleryHeading: string;
  faqHeading: string;
  regHeading: string;
  regNote: string;
  phone: string;
  whatsapp: string;
  email: string;
  facebook: string;
  instagram: string;
  youtube: string;
  closingText: string;
  footerText: string;
  show: Record<SectionKey, boolean>;
  registrationOpen: boolean;
  form: FormRules;
};

export type SiteImage = { id: string; url: string; alt: string; caption: string; width: number; height: number };

export type ItemStatus = 'draft' | 'published' | 'changed';

export type PublicPage = Omit<PageSettings, 'logo' | 'poster' | 'aboutImage' | 'form'> & {
  logo: SiteImage | null;
  poster: SiteImage | null;
  aboutImage: SiteImage | null;
};

type Marked = { id: string; status?: ItemStatus };

export type ProgrammeEntry = Marked & { type: 'session' | 'break'; title: string; start: string; end: string; stage: string; speakers: string[]; description: string };
export type SpeakerEntry = Marked & { name: string; role: string; bio: string; photo: SiteImage | null };
export type AnnouncementEntry = Marked & { title: string; body: string; linkText: string; linkUrl: string; pinned: boolean };
export type FaqEntry = Marked & { question: string; answer: string };
export type GalleryEntry = Marked & { image: SiteImage; caption: string };

export type PublicSite = {
  preview: boolean;
  registrationOpen: boolean;
  page: PublicPage;
  programme: ProgrammeEntry[];
  speakers: SpeakerEntry[];
  announcements: AnnouncementEntry[];
  faqs: FaqEntry[];
  gallery: GalleryEntry[];
  publishedAt: string | null;
};

export type SettingsResponse = {
  draft: PageSettings;
  published: PageSettings | null;
  version: number;
  updatedAt: string | null;
  updatedByName: string;
  publishedAt: string | null;
  publishedByName: string;
  hasUnpublishedChanges: boolean;
  passesIssued?: number;
};

export type ItemKind = 'programme' | 'speaker' | 'announcement' | 'faq' | 'gallery';

export type ItemData = {
  programme: { type: 'session' | 'break'; title: string; start: string; end: string; stage: string; speakerIds: string[]; description: string };
  speaker: { name: string; role: string; photo: string; bio: string };
  announcement: { title: string; body: string; linkText: string; linkUrl: string; pinned: boolean };
  faq: { question: string; answer: string };
  gallery: { image: string; caption: string };
};

export type ContentItem<K extends ItemKind = ItemKind> = {
  id: string;
  kind: K;
  draft: ItemData[K];
  published: ItemData[K] | null;
  status: ItemStatus;
  order: number;
  version: number;
  updatedAt: string;
  updatedByName: string;
  publishedAt: string | null;
};

export type LibraryImage = SiteImage & {
  mime: string;
  size: number;
  originalName: string;
  uploadedByName: string;
  createdAt: string;
  replacedAt: string | null;
  usedIn: string[];
};
