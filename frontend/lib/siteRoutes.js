// The event is served from the apex of its own domain, so every public URL is
// built here instead of being assembled from the event slug at call sites.
// Keeping the paths in one module makes a route rename a single change and lets
// the tests assert the public URLs the booking flow sends attendees to.

export const EVENT_HOME_URL = '/';
export const BOOKING_PAGE_URL = '/book';
export const BACK_OFFICE_HOME_URL = '/admin';

export function buildEventHomeUrl() {
  return EVENT_HOME_URL;
}

export function buildBookingPageUrl() {
  return BOOKING_PAGE_URL;
}

export function buildPaymentPageUrlForPaymentId(paymentId) {
  return `/pay/${encodeURIComponent(paymentId)}`;
}

export function buildSuccessPageUrlForReferenceCode(bookingReferenceCode) {
  return `/success/${encodeURIComponent(bookingReferenceCode)}`;
}

export function buildEventHomeSectionUrlForSectionId(sectionId) {
  return `${EVENT_HOME_URL}#${sectionId}`;
}
