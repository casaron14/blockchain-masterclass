import {
  EVENT_CONFIGURATIONS,
  fetchPrimaryEventConfiguration,
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_USDT_BEP20,
  PAYMENT_METHOD_LIPANAMBA,
} from '../../shared/eventConfig.js';

export {
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_USDT_BEP20,
  PAYMENT_METHOD_LIPANAMBA,
};

const primaryEventConfiguration = fetchPrimaryEventConfiguration();

export const DEFAULT_EVENT_SLUG = primaryEventConfiguration.slug;

export const SUPPORTED_PAYMENT_METHODS = Object.freeze(
  Object.fromEntries(
    primaryEventConfiguration.paymentMethods.map((paymentMethod) => [
      paymentMethod,
      paymentMethod,
    ])
  )
);

export const PAYMENT_METHOD_LABEL_KEYS = {
  azampesa: 'payment.instantPayment',
  usdt_bep20: 'payment.usdt',
  lipanamba: 'payment.lipanamba',
};

export const defaultEventConfig = {
  slug: primaryEventConfiguration.slug,
  name: primaryEventConfiguration.name,
  tagline: primaryEventConfiguration.tagline,
  dateLabel: primaryEventConfiguration.event.date,
  location: primaryEventConfiguration.event.location,
  durationDays: primaryEventConfiguration.durationDays,
  seatHoldMinutes: primaryEventConfiguration.seatHoldMinutes,
  currency: primaryEventConfiguration.price.localCurrency,
  ticketPrice: primaryEventConfiguration.price.localAmount,
  regularTicketPrice: primaryEventConfiguration.price.regularLocalAmount,
  cryptoAmount: primaryEventConfiguration.price.cryptoAmount,
  cryptoCurrency: primaryEventConfiguration.price.cryptoCurrency,
  cryptoNetwork: primaryEventConfiguration.price.cryptoNetwork,
  seatCapacity: primaryEventConfiguration.seatCapacity,
  phonePlaceholder: primaryEventConfiguration.phonePlaceholder,
  supportPhone: primaryEventConfiguration.contact.supportPhone,
  supportEmail: primaryEventConfiguration.contact.supportEmail,
  addressLine1: primaryEventConfiguration.contact.addressLine1,
  addressLine2: primaryEventConfiguration.contact.addressLine2,
  platformName: primaryEventConfiguration.contact.platformName,
  lipaNambaNumber: primaryEventConfiguration.payment.lipaNambaNumber,
  lipaNambaAccountName: primaryEventConfiguration.payment.lipaNambaAccountName,
  paymentMethods: primaryEventConfiguration.paymentMethods.map((paymentMethod) => ({
    key: paymentMethod,
    labelKey: PAYMENT_METHOD_LABEL_KEYS[paymentMethod] || `payment.${paymentMethod}`,
  })),
  comingSoonPaymentMethods: primaryEventConfiguration.comingSoonPaymentMethods.map(
    (paymentMethod) => ({
      key: paymentMethod,
      labelKey: PAYMENT_METHOD_LABEL_KEYS[paymentMethod] || `payment.${paymentMethod}`,
    })
  ),
};

export function checkEventSlugExistsInConfiguration(eventSlug) {
  return EVENT_CONFIGURATIONS.some(
    (eventConfiguration) => eventConfiguration.slug === eventSlug
  );
}

export function buildPaymentMethodOptions(
  paymentMethods,
  fallbackPaymentMethodOptions = defaultEventConfig.paymentMethods
) {
  if (!Array.isArray(paymentMethods) || paymentMethods.length === 0) {
    return fallbackPaymentMethodOptions;
  }
  return paymentMethods.map((paymentMethod) => {
    if (paymentMethod && typeof paymentMethod === 'object' && paymentMethod.key) {
      return paymentMethod;
    }
    const methodKey = String(paymentMethod);
    return {
      key: methodKey,
      labelKey: PAYMENT_METHOD_LABEL_KEYS[methodKey] || `payment.${methodKey}`,
    };
  });
}

export function buildEventConfigFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return defaultEventConfig;
  }

  const eventDetails = payload.event || {};
  const priceDetails = payload.price || {};
  const contactDetails = payload.contact || {};
  const paymentDetails = payload.payment || {};

  return {
    slug: payload.slug || defaultEventConfig.slug,
    name: payload.name || defaultEventConfig.name,
    tagline: payload.tagline || defaultEventConfig.tagline,
    dateLabel:
      eventDetails.date ||
      payload.date ||
      payload.dateLabel ||
      defaultEventConfig.dateLabel,
    location:
      eventDetails.location ||
      payload.location ||
      defaultEventConfig.location,
    durationDays:
      payload.durationDays ?? defaultEventConfig.durationDays,
    seatHoldMinutes:
      payload.seatHoldMinutes ?? defaultEventConfig.seatHoldMinutes,
    currency:
      priceDetails.localCurrency ||
      payload.currency ||
      defaultEventConfig.currency,
    ticketPrice:
      priceDetails.localAmount ??
      payload.ticketPrice ??
      defaultEventConfig.ticketPrice,
    regularTicketPrice:
      priceDetails.regularLocalAmount ??
      payload.regularTicketPrice ??
      defaultEventConfig.regularTicketPrice,
    cryptoAmount:
      priceDetails.cryptoAmount ??
      payload.cryptoAmount ??
      defaultEventConfig.cryptoAmount,
    cryptoCurrency:
      priceDetails.cryptoCurrency ||
      payload.cryptoCurrency ||
      defaultEventConfig.cryptoCurrency,
    cryptoNetwork:
      priceDetails.cryptoNetwork ||
      payload.cryptoNetwork ||
      defaultEventConfig.cryptoNetwork,
    seatCapacity:
      payload.seatCapacity ?? defaultEventConfig.seatCapacity,
    phonePlaceholder:
      payload.phonePlaceholder || defaultEventConfig.phonePlaceholder,
    supportPhone:
      contactDetails.supportPhone ||
      payload.supportPhone ||
      defaultEventConfig.supportPhone,
    supportEmail:
      contactDetails.supportEmail ||
      payload.supportEmail ||
      defaultEventConfig.supportEmail,
    addressLine1:
      contactDetails.addressLine1 ||
      payload.addressLine1 ||
      defaultEventConfig.addressLine1,
    addressLine2:
      contactDetails.addressLine2 ||
      payload.addressLine2 ||
      defaultEventConfig.addressLine2,
    platformName:
      contactDetails.platformName ||
      payload.platformName ||
      defaultEventConfig.platformName,
    lipaNambaNumber:
      paymentDetails.lipaNambaNumber ||
      payload.lipaNambaNumber ||
      defaultEventConfig.lipaNambaNumber,
    lipaNambaAccountName:
      paymentDetails.lipaNambaAccountName ||
      payload.lipaNambaAccountName ||
      defaultEventConfig.lipaNambaAccountName,
    paymentMethods: buildPaymentMethodOptions(payload.paymentMethods),
    comingSoonPaymentMethods: buildPaymentMethodOptions(
      payload.comingSoonPaymentMethods,
      defaultEventConfig.comingSoonPaymentMethods
    ),
  };
}