import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchEventConfigurationBySlug,
  EVENT_CONFIGURATIONS,
  PRIMARY_EVENT_SLUG,
  EVENT_TITLE,
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
  EVENT_DURATION_DAYS,
  SEAT_HOLD_DURATION_MINUTES,
  TICKET_PRICE_TZS,
  REGULAR_TICKET_PRICE_TZS,
  TICKET_PRICE_USDT,
  LOCAL_CURRENCY_CODE,
  CRYPTO_CURRENCY_CODE,
  CRYPTO_NETWORK,
  SEAT_CAPACITY,
  PHONE_PLACEHOLDER,
  SUPPORT_EMAIL_ADDRESS,
  SUPPORT_PHONE_NUMBER,
  PAYMENT_METHOD_AZAMPESA,
  PAYMENT_METHOD_USDT_BEP20,
  PAYMENT_METHOD_LIPANAMBA,
  LIPA_NAMBA_NUMBER,
  LIPA_NAMBA_ACCOUNT_NAME,
  OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES,
  VALID_PAYMENT_METHODS,
  SELLABLE_PAYMENT_METHODS,
  COMING_SOON_PAYMENT_METHODS,
  CONFIGURED_PAYMENT_METHODS,
  AZAMPESA_PAYMENTS_ENABLED,
  isConfiguredPaymentMethod,
} from '../services/eventConfigService.js';

test('fetchEventConfigurationBySlug returns the masterclass configuration for a known slug', () => {
  const eventConfiguration = fetchEventConfigurationBySlug('blockchain-masterclass');
  assert.ok(eventConfiguration);
  assert.equal(eventConfiguration.slug, 'blockchain-masterclass');
  assert.equal(eventConfiguration.name, 'Blockchain Masterclass');
  assert.equal(eventConfiguration.price.cryptoAmount, 3.8);
  assert.equal(eventConfiguration.seatCapacity, 150);
  assert.equal(eventConfiguration.seatHoldMinutes, 60);
  assert.equal(eventConfiguration.durationDays, 1);
  assert.deepEqual(eventConfiguration.paymentMethods, ['lipanamba']);
  assert.deepEqual(eventConfiguration.comingSoonPaymentMethods, [
    'azampesa',
    'usdt_bep20',
  ]);
});

test('fetchEventConfigurationBySlug returns null for an unknown slug', () => {
  assert.equal(fetchEventConfigurationBySlug('unknown-slug'), null);
});

test('EVENT_CONFIGURATIONS exposes the documented frontend contract shape', () => {
  assert.ok(Array.isArray(EVENT_CONFIGURATIONS));
  assert.ok(EVENT_CONFIGURATIONS.length >= 1);
  const firstConfiguration = EVENT_CONFIGURATIONS[0];
  assert.equal(typeof firstConfiguration.slug, 'string');
  assert.ok(firstConfiguration.event.date);
  assert.ok(firstConfiguration.event.location);
  assert.equal(typeof firstConfiguration.price.localCurrency, 'string');
  assert.equal(typeof firstConfiguration.price.localAmount, 'number');
  assert.ok(firstConfiguration.contact.supportEmail);
  assert.ok(Array.isArray(firstConfiguration.paymentMethods));
});

test('derived constants match the primary event configuration', () => {
  const primaryConfiguration = fetchEventConfigurationBySlug(PRIMARY_EVENT_SLUG);

  assert.equal(EVENT_TITLE, primaryConfiguration.name);
  assert.equal(EVENT_DATE_LABEL, primaryConfiguration.event.date);
  assert.equal(EVENT_LOCATION, primaryConfiguration.event.location);
  assert.equal(EVENT_DURATION_DAYS, primaryConfiguration.durationDays);
  assert.equal(SEAT_HOLD_DURATION_MINUTES, primaryConfiguration.seatHoldMinutes);
  assert.equal(SEAT_CAPACITY, primaryConfiguration.seatCapacity);
  assert.equal(PHONE_PLACEHOLDER, primaryConfiguration.phonePlaceholder);

  assert.equal(LOCAL_CURRENCY_CODE, primaryConfiguration.price.localCurrency);
  assert.equal(TICKET_PRICE_TZS, primaryConfiguration.price.localAmount);
  assert.equal(REGULAR_TICKET_PRICE_TZS, primaryConfiguration.price.regularLocalAmount);
  assert.equal(CRYPTO_CURRENCY_CODE, primaryConfiguration.price.cryptoCurrency);
  assert.equal(CRYPTO_NETWORK, primaryConfiguration.price.cryptoNetwork);
  assert.equal(TICKET_PRICE_USDT, primaryConfiguration.price.cryptoAmount);

  assert.equal(SUPPORT_EMAIL_ADDRESS, primaryConfiguration.contact.supportEmail);
  assert.equal(SUPPORT_PHONE_NUMBER, primaryConfiguration.contact.supportPhone);

  assert.equal(PAYMENT_METHOD_LIPANAMBA, primaryConfiguration.paymentMethods[0]);
  assert.equal(LIPA_NAMBA_NUMBER, primaryConfiguration.payment.lipaNambaNumber);
  assert.equal(
    LIPA_NAMBA_ACCOUNT_NAME,
    primaryConfiguration.payment.lipaNambaAccountName
  );
  assert.equal(
    OFFLINE_PAYMENT_REVIEW_HOLD_MINUTES,
    primaryConfiguration.payment.offlineReviewHoldMinutes
  );
  assert.deepEqual(SELLABLE_PAYMENT_METHODS, primaryConfiguration.paymentMethods);
  assert.deepEqual(COMING_SOON_PAYMENT_METHODS, [
    PAYMENT_METHOD_AZAMPESA,
    PAYMENT_METHOD_USDT_BEP20,
  ]);
  assert.deepEqual(CONFIGURED_PAYMENT_METHODS, [
    PAYMENT_METHOD_USDT_BEP20,
    PAYMENT_METHOD_LIPANAMBA,
  ]);
  assert.deepEqual(VALID_PAYMENT_METHODS, [
    PAYMENT_METHOD_AZAMPESA,
    PAYMENT_METHOD_USDT_BEP20,
    PAYMENT_METHOD_LIPANAMBA,
  ]);
});

test('AzamPesa is retired as a new payment method but remains a valid historical value', () => {
  assert.equal(AZAMPESA_PAYMENTS_ENABLED, false);
  assert.equal(isConfiguredPaymentMethod(PAYMENT_METHOD_AZAMPESA), false);
  assert.equal(isConfiguredPaymentMethod(PAYMENT_METHOD_USDT_BEP20), true);
  assert.equal(isConfiguredPaymentMethod(PAYMENT_METHOD_LIPANAMBA), true);
});