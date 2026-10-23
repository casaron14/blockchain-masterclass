function buildReferralSourceKey(eventSlug) {
  return `referralUtmSource:${eventSlug}`;
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
    // storage can be unavailable (private mode); tracking is best-effort only
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

export function storeReferralSourceLocally(eventSlug, utmSourceValue) {
  writeLocalStorageValue(buildReferralSourceKey(eventSlug), utmSourceValue);
}

export function fetchStoredReferralSource(eventSlug) {
  return readLocalStorageValue(buildReferralSourceKey(eventSlug));
}

export function clearStoredReferralSource(eventSlug) {
  removeLocalStorageValue(buildReferralSourceKey(eventSlug));
}