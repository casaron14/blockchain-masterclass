// Single source of truth for every event business value used across the
// codebase. The backend exposes these through services/eventConfigService.js
// and the frontend imports this file directly at build time via
// frontend/lib/eventConfig.js. Other business facts (attendee data, DB row
// seeds) that cannot import this module must be kept in sync manually.

export const PRIMARY_EVENT_SLUG = 'blockchain-masterclass';

export const EVENT_CONFIGURATIONS = [
  {
    slug: PRIMARY_EVENT_SLUG,
    name: 'Blockchain Masterclass',
    tagline: 'Book your seat for the Blockchain Masterclass event.',
    event: {
      date: '7th November 2026',
      // DD/MM/YYYY form printed on the event pass. Keep it in sync with `date`.
      ticketDateLabel: '07/11/2026',
      location: 'Arusha, Tanzania',
      venueName: 'Village Hall Mafao House',
      motto: 'Jenga mustakabali kwa Blockchain',
      brandName: 'Inkryptus',
      websiteAddress: 'inkryptus.com',
    },
    durationDays: 1,
    price: {
      localCurrency: 'TZS',
      localAmount: 10000,
      regularLocalAmount: 30000,
      cryptoCurrency: 'USDT',
      cryptoNetwork: 'BEP20',
      cryptoAmount: 3.8,
      regularCryptoAmount: 11.27,
    },
    seatCapacity: 150,
    seatHoldMinutes: 60,
    phonePlaceholder: '0XXXXXXXXX',
    contact: {
      brandName: 'DienAcademy',
      websiteAddress: 'dienacademy.com',
      supportEmail: 'support@dienacademy.com',
      supportPhone: '+255 621 745 217',
      addressLine1: 'Dar es Salaam, Tanzania',
      addressLine2: 'P.O. Box 689',
      platformName: 'DienAcademy.com',
    },
    payment: {
      lipaNambaNumber: '15611485',
      lipaNambaAccountName: 'DienAcademy',
      offlineReviewHoldMinutes: 1440,
    },
    // Only Lipa Namba is sold right now. The other rails are advertised in the
    // checkout as "coming soon" but can never be selected for a new booking.
    paymentMethods: ['lipanamba'],
    // AzamPesa (STK push) is not integrated yet, and USDT/BEP20 is paused.
    // These keys are display-only; historical rows stay readable through
    // VALID_PAYMENT_METHODS below.
    comingSoonPaymentMethods: ['azampesa', 'usdt_bep20'],
  },
];

export function fetchEventConfigurationBySlug(eventSlug) {
  return EVENT_CONFIGURATIONS.find(
    (eventConfiguration) => eventConfiguration.slug === eventSlug
  ) ?? null;
}

export function fetchPrimaryEventConfiguration() {
  return fetchEventConfigurationBySlug(PRIMARY_EVENT_SLUG);
}

export const PAYMENT_METHOD_AZAMPESA = 'azampesa';
export const PAYMENT_METHOD_USDT_BEP20 = 'usdt_bep20';
export const PAYMENT_METHOD_LIPANAMBA = 'lipanamba';

// Turns the AzamPesa initiation route and the AzamPay webhook off at the
// process boundary. The service code stays because old payments must still be
// readable and reconcilable in the admin transaction view.
export const AZAMPESA_PAYMENTS_ENABLED = false;

const primaryEventConfiguration = fetchPrimaryEventConfiguration();

export const EVENT_TITLE = primaryEventConfiguration.name;
export const EVENT_TAGLINE = primaryEventConfiguration.tagline;
export const EVENT_DATE_LABEL = primaryEventConfiguration.event.date;
export const EVENT_TICKET_DATE_LABEL = primaryEventConfiguration.event.ticketDateLabel;
export const EVENT_LOCATION = primaryEventConfiguration.event.location;
export const EVENT_VENUE_NAME = primaryEventConfiguration.event.venueName;
export const EVENT_MOTTO = primaryEventConfiguration.event.motto;
export const EVENT_BRAND_NAME = primaryEventConfiguration.event.brandName;
export const EVENT_WEBSITE_ADDRESS = primaryEventConfiguration.event.websiteAddress;
export const EVENT_DURATION_DAYS = primaryEventConfiguration.durationDays;
export const EVENT_SEAT_HOLD_MINUTES = primaryEventConfiguration.seatHoldMinutes;

export const LOCAL_CURRENCY_CODE = primaryEventConfiguration.price.localCurrency;
export const TICKET_PRICE_TZS = primaryEventConfiguration.price.localAmount;
export const REGULAR_TICKET_PRICE_TZS = primaryEventConfiguration.price.regularLocalAmount;
export const CRYPTO_CURRENCY_CODE = primaryEventConfiguration.price.cryptoCurrency;
export const CRYPTO_NETWORK = primaryEventConfiguration.price.cryptoNetwork;
export const TICKET_PRICE_USDT = primaryEventConfiguration.price.cryptoAmount;

export const SEAT_CAPACITY = primaryEventConfiguration.seatCapacity;
export const SEAT_HOLD_DURATION_MINUTES = primaryEventConfiguration.seatHoldMinutes;
export const PHONE_PLACEHOLDER = primaryEventConfiguration.phonePlaceholder;

// The event sells a single admission tier, so every ticket carries the same
// label. It lives here because both the PNG renderer and the email delivery
// metadata need the exact same text.
export const TICKET_TYPE_LABEL = 'General Admission';

export const SUPPORT_EMAIL_ADDRESS = primaryEventConfiguration.contact.supportEmail;
export const SUPPORT_PHONE_NUMBER = primaryEventConfiguration.contact.supportPhone;
export const ADDRESS_LINE_1 = primaryEventConfiguration.contact.addressLine1;
export const ADDRESS_LINE_2 = primaryEventConfiguration.contact.addressLine2;
export const PLATFORM_NAME = primaryEventConfiguration.contact.platformName;
export const PLATFORM_BRAND_NAME = primaryEventConfiguration.contact.brandName;
export const PLATFORM_WEBSITE_ADDRESS = primaryEventConfiguration.contact.websiteAddress;

export const LIPA_NAMBA_NUMBER = primaryEventConfiguration.payment.lipaNambaNumber;
export const LIPA_NAMBA_ACCOUNT_NAME = primaryEventConfiguration.payment.lipaNambaAccountName;
export const OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES =
  primaryEventConfiguration.payment.offlineReviewHoldMinutes;

// Payment methods a new booking may choose right now. This is what the event
// payload exposes to the frontend as the selectable list.
export const SELLABLE_PAYMENT_METHODS = Object.freeze([
  ...primaryEventConfiguration.paymentMethods,
]);

// Payment methods the checkout advertises but cannot select yet. The frontend
// renders them as muted "coming soon" cards.
export const COMING_SOON_PAYMENT_METHODS = Object.freeze([
  ...primaryEventConfiguration.comingSoonPaymentMethods,
]);

// Methods the API still accepts when it creates a payment record. Kept wider
// than SELLABLE_PAYMENT_METHODS on purpose: USDT invoices created before the
// crypto rail was muted are still being settled by the listener, sweep and
// reconciliation jobs, so those records must remain valid.
export const CONFIGURED_PAYMENT_METHODS = Object.freeze([
  PAYMENT_METHOD_USDT_BEP20,
  PAYMENT_METHOD_LIPANAMBA,
]);

// Every method that can exist in the database, including retired ones. Used to
// validate and display historical rows; it must never shrink.
export const VALID_PAYMENT_METHODS = Object.freeze([
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_USDT_BEP20,
  PAYMENT_METHOD_LIPANAMBA,
]);

export function isConfiguredPaymentMethod(paymentMethod) {
  return CONFIGURED_PAYMENT_METHODS.includes(paymentMethod);
}