export function buildNotFoundDestinationLinks(eventSlug) {
  return {
    eventHome: `/${eventSlug}`,
    bookingLookup: `/${eventSlug}/book`,
    backOffice: '/admin',
  };
}
