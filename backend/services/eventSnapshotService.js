import {
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_LIPANAMBA,
  PAYMENT_METHOD_USDT_BEP20,
  TICKET_TYPE_LABEL,
  fetchPrimaryEventConfiguration,
} from './eventConfigService.js';

// Every booking carries the event values that were true when the seat was
// sold. These helpers turn that snapshot into the labels each document needs,
// so a later edit to an event cannot rewrite an old ticket or receipt.
export function parseStoredEventSnapshotValue(rawEventSnapshotValue) {
  if (!rawEventSnapshotValue) {
    return null;
  }

  if (typeof rawEventSnapshotValue === 'object') {
    return rawEventSnapshotValue;
  }

  try {
    const parsedValue = JSON.parse(rawEventSnapshotValue);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null;
  } catch {
    return null;
  }
}

export function resolveEventSnapshotForBookingRecord(bookingRecord) {
  const storedSnapshot = parseStoredEventSnapshotValue(bookingRecord?.event_snapshot);
  if (storedSnapshot?.slug && storedSnapshot?.name) {
    return storedSnapshot;
  }

  const primaryEventConfiguration = fetchPrimaryEventConfiguration();
  return primaryEventConfiguration
    ? JSON.parse(JSON.stringify(primaryEventConfiguration))
    : null;
}

export function buildEventDisplayDetailsFromSnapshot(eventSnapshot) {
  const resolvedSnapshot = eventSnapshot ?? fetchPrimaryEventConfiguration();
  if (!resolvedSnapshot) {
    throw new Error('EVENT_SNAPSHOT_MISSING');
  }

  const eventDetails = resolvedSnapshot.event ?? {};
  const priceDetails = resolvedSnapshot.price ?? {};
  const contactDetails = resolvedSnapshot.contact ?? {};
  const paymentDetails = resolvedSnapshot.payment ?? {};

  return {
    slug: resolvedSnapshot.slug,
    eventTitle: resolvedSnapshot.name,
    eventTagline: resolvedSnapshot.tagline ?? '',
    eventDate: eventDetails.date ?? '',
    eventTicketDateLabel: eventDetails.ticketDateLabel ?? eventDetails.date ?? '',
    eventLocation: eventDetails.location ?? '',
    eventVenueName: eventDetails.venueName ?? '',
    eventMotto: eventDetails.motto ?? '',
    eventBrandName: eventDetails.brandName ?? '',
    eventWebsiteAddress: eventDetails.websiteAddress ?? '',
    eventTimeLabel:
      eventDetails.timeLabel ?? process.env.EVENT_TIME_LABEL?.trim() ?? '',
    eventDurationDays: resolvedSnapshot.durationDays ?? 1,
    ticketTypeLabel: TICKET_TYPE_LABEL,
    localCurrencyCode: priceDetails.localCurrency ?? 'TZS',
    localAmount: Number(priceDetails.localAmount ?? 0),
    regularLocalAmount: Number(priceDetails.regularLocalAmount ?? 0),
    cryptoCurrencyCode: priceDetails.cryptoCurrency ?? 'USDT',
    cryptoNetwork: priceDetails.cryptoNetwork ?? 'BEP20',
    cryptoAmount: Number(priceDetails.cryptoAmount ?? 0),
    regularCryptoAmount: Number(priceDetails.regularCryptoAmount ?? 0),
    supportEmailAddress: contactDetails.supportEmail ?? '',
    supportPhoneNumber: contactDetails.supportPhone ?? '',
    platformBrandName: contactDetails.brandName ?? '',
    platformWebsiteAddress: contactDetails.websiteAddress ?? '',
    lipaNambaNumber: paymentDetails.lipaNambaNumber ?? '',
    lipaNambaAccountName: paymentDetails.lipaNambaAccountName ?? '',
    offlineReviewHoldMinutes: Number(paymentDetails.offlineReviewHoldMinutes ?? 1440),
    paymentMethods: Array.isArray(resolvedSnapshot.paymentMethods)
      ? [...resolvedSnapshot.paymentMethods]
      : [],
    comingSoonPaymentMethods: Array.isArray(resolvedSnapshot.comingSoonPaymentMethods)
      ? [...resolvedSnapshot.comingSoonPaymentMethods]
      : [],
  };
}

export function resolveExpectedAmountForPaymentMethodFromEventSnapshot(
  paymentMethod,
  eventSnapshot
) {
  const eventDisplayDetails = buildEventDisplayDetailsFromSnapshot(eventSnapshot);

  if (paymentMethod === PAYMENT_METHOD_USDT_BEP20) {
    return eventDisplayDetails.cryptoAmount;
  }

  if (
    paymentMethod === PAYMENT_METHOD_LIPANAMBA ||
    paymentMethod === PAYMENT_METHOD_AZAMPESA
  ) {
    return eventDisplayDetails.localAmount;
  }

  return null;
}

export function buildTicketEventDetailsFromSnapshot(eventSnapshot) {
  const eventDisplayDetails = buildEventDisplayDetailsFromSnapshot(eventSnapshot);

  return {
    eventTitle: eventDisplayDetails.eventTitle,
    eventTicketDateLabel: eventDisplayDetails.eventTicketDateLabel,
    eventDate: eventDisplayDetails.eventDate,
    eventLocation: `${eventDisplayDetails.eventVenueName}, ${eventDisplayDetails.eventLocation}`,
    eventVenueName: eventDisplayDetails.eventVenueName,
    eventMotto: eventDisplayDetails.eventMotto,
    eventBrandName: eventDisplayDetails.eventBrandName,
    eventWebsiteAddress: eventDisplayDetails.eventWebsiteAddress,
    eventTimeLabel: eventDisplayDetails.eventTimeLabel,
    supportPhoneNumber: eventDisplayDetails.supportPhoneNumber,
    ticketTypeLabel: eventDisplayDetails.ticketTypeLabel,
  };
}
