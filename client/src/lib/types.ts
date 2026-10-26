// Registration workflow: Submitted -> Confirmed. The entry pass steps
// (generated, sent) are tracked separately in PassStatus.
export type Status = 'submitted' | 'confirmed';
export type PassStatus = 'not_generated' | 'generated' | 'sent' | 'send_failed';
export type Role = 'admin' | 'staff';
export type Permission = 'view' | 'approve' | 'send' | 'gate';

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
  registration: RegistrationItem & { statusHistory: HistoryEntry[]; updatedAt: string };
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
