function buildBookingKey(eventSlug) {
  return `bookingRecord:${eventSlug}`;
}

function buildPaymentKey(eventSlug) {
  return `paymentId:${eventSlug}`;
}

function buildBookingDraftKey(eventSlug) {
  return `bookingDraft:${eventSlug}`;
}

function readLocalStorageValue(storageKey) {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeLocalStorageValue(storageKey, rawValue) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, rawValue);
  } catch {
    // storage can be unavailable (private mode); progress saving is best-effort only
  }
}

function removeLocalStorageValue(storageKey) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore unavailability
  }
}

export function storeBookingRecordLocally(eventSlug, bookingRecord) {
  writeLocalStorageValue(buildBookingKey(eventSlug), JSON.stringify(bookingRecord));
}

export function fetchStoredBookingRecord(eventSlug) {
  const rawValue = readLocalStorageValue(buildBookingKey(eventSlug));
  if (!rawValue) {
    return null;
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

export function storePaymentIdLocally(eventSlug, paymentId) {
  writeLocalStorageValue(buildPaymentKey(eventSlug), String(paymentId));
}

export function fetchStoredPaymentId(eventSlug) {
  const rawValue = readLocalStorageValue(buildPaymentKey(eventSlug));
  return rawValue ? Number(rawValue) : null;
}

export function clearStoredBookingProgress(eventSlug) {
  removeLocalStorageValue(buildBookingKey(eventSlug));
  removeLocalStorageValue(buildPaymentKey(eventSlug));
}

export function storeBookingDraftLocally(eventSlug, bookingDraft) {
  writeLocalStorageValue(buildBookingDraftKey(eventSlug), JSON.stringify(bookingDraft));
}

export function fetchStoredBookingDraft(eventSlug) {
  const rawValue = readLocalStorageValue(buildBookingDraftKey(eventSlug));
  if (!rawValue) {
    return null;
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

export function clearStoredBookingDraft(eventSlug) {
  removeLocalStorageValue(buildBookingDraftKey(eventSlug));
}

const ATTENDEE_PROFILE_STORAGE_KEY = 'attendeeProfile';

function buildAttendeeProfileKey(eventSlug) {
  const normalizedEventSlug = String(eventSlug ?? '').trim();
  return normalizedEventSlug
    ? `${ATTENDEE_PROFILE_STORAGE_KEY}:${normalizedEventSlug}`
    : ATTENDEE_PROFILE_STORAGE_KEY;
}

export function storeAttendeeProfileLocally(attendeeProfile, eventSlug = null) {
  writeLocalStorageValue(
    buildAttendeeProfileKey(eventSlug),
    JSON.stringify(attendeeProfile)
  );
}

export function fetchStoredAttendeeProfile(eventSlug = null) {
  const rawValue = readLocalStorageValue(buildAttendeeProfileKey(eventSlug));
  if (!rawValue) {
    return null;
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

export function clearStoredAttendeeProfile(eventSlug = null) {
  removeLocalStorageValue(buildAttendeeProfileKey(eventSlug));
}