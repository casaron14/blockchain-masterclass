// The event is served from the apex of its own domain, so every public URL is
// built here instead of being assembled from the event slug at call sites.
// Keeping the paths in one module makes a route rename a single change and lets
// the tests assert the public URLs the booking flow sends attendees to.

export const EVENT_HOME_URL = '/';
export const BOOKING_PAGE_URL = '/book';
export const BACK_OFFICE_HOME_URL = '/admin';

function buildEventScopedBasePath(eventSlug, unscopedBasePath) {
  const normalizedEventSlug = String(eventSlug ?? '').trim();
  if (!normalizedEventSlug) {
    return unscopedBasePath;
  }

  const scopedEventBasePath = `/events/${encodeURIComponent(normalizedEventSlug)}`;
  return unscopedBasePath === '/'
    ? scopedEventBasePath
    : `${scopedEventBasePath}${unscopedBasePath}`;
}

export function buildEventHomeUrl(eventSlug = null) {
  return buildEventScopedBasePath(eventSlug, EVENT_HOME_URL) || '/';
}

export function buildBookingPageUrl(eventSlug = null) {
  return buildEventScopedBasePath(eventSlug, BOOKING_PAGE_URL);
}

export function buildPaymentPageUrlForPaymentId(paymentId, eventSlug = null) {
  return buildEventScopedBasePath(
    eventSlug,
    `/pay/${encodeURIComponent(paymentId)}`
  );
}

export function buildPaymentConfirmationPageUrlForPaymentId(
  paymentId,
  eventSlug = null
) {
  return buildEventScopedBasePath(
    eventSlug,
    `/pay/${encodeURIComponent(paymentId)}/confirm`
  );
}

export function buildSuccessPageUrlForReferenceCode(
  bookingReferenceCode,
  eventSlug = null
) {
  return buildEventScopedBasePath(
    eventSlug,
    `/success/${encodeURIComponent(bookingReferenceCode)}`
  );
}

export function buildEventHomeSectionUrlForSectionId(sectionId, eventSlug = null) {
  return `${buildEventHomeUrl(eventSlug)}#${sectionId}`;
}
