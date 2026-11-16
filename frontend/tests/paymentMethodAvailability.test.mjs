import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEventConfigFromPayload,
  buildPaymentMethodOptions,
  defaultEventConfig,
  SUPPORTED_PAYMENT_METHODS,
} from '../lib/eventConfig.js';
import { translations } from '../lib/translations.js';

function fetchPaymentMethodKeys(paymentMethodOptions) {
  return paymentMethodOptions.map((paymentMethodOption) => paymentMethodOption.key);
}

function resolveTranslationValue(languageCode, translationKey) {
  return translationKey
    .split('.')
    .reduce(
      (translationNode, pathSegment) => translationNode?.[pathSegment],
      translations[languageCode]
    );
}

test('Lipa Namba is the only selectable payment method while USDT/BEP20 is advertised as coming soon', () => {
  assert.deepEqual(fetchPaymentMethodKeys(defaultEventConfig.paymentMethods), ['lipanamba']);
  assert.deepEqual(fetchPaymentMethodKeys(defaultEventConfig.comingSoonPaymentMethods), [
    'azampesa',
    'usdt_bep20',
  ]);
});

test('the muted USDT/BEP20 card keeps the crypto label on its coming-soon entry', () => {
  const comingSoonUsdtOption = defaultEventConfig.comingSoonPaymentMethods.find(
    (paymentMethodOption) => paymentMethodOption.key === 'usdt_bep20'
  );

  assert.equal(comingSoonUsdtOption.labelKey, 'payment.usdt');
});

test('a backend payload that still sells USDT/BEP20 moves it to coming soon instead of rendering it as selectable', () => {
  const eventConfigFromPayload = buildEventConfigFromPayload({
    slug: 'blockchain-masterclass',
    paymentMethods: ['lipanamba', 'usdt_bep20'],
  });

  assert.deepEqual(fetchPaymentMethodKeys(eventConfigFromPayload.paymentMethods), ['lipanamba']);
  assert.deepEqual(fetchPaymentMethodKeys(eventConfigFromPayload.comingSoonPaymentMethods), [
    'azampesa',
    'usdt_bep20',
  ]);
});

test('a payload that already advertises USDT/BEP20 as coming soon does not duplicate the card', () => {
  const eventConfigFromPayload = buildEventConfigFromPayload({
    slug: 'blockchain-masterclass',
    paymentMethods: ['lipanamba'],
    comingSoonPaymentMethods: ['azampesa', 'usdt_bep20'],
  });

  assert.deepEqual(fetchPaymentMethodKeys(eventConfigFromPayload.paymentMethods), ['lipanamba']);
  assert.deepEqual(fetchPaymentMethodKeys(eventConfigFromPayload.comingSoonPaymentMethods), [
    'azampesa',
    'usdt_bep20',
  ]);
});

test('USDT/BEP20 stays a supported method so existing crypto invoices keep settling', () => {
  assert.equal(SUPPORTED_PAYMENT_METHODS.usdt_bep20, 'usdt_bep20');
});

test('AzamPay stays advertised as coming soon with its own label', () => {
  const comingSoonAzampesaOption = defaultEventConfig.comingSoonPaymentMethods.find(
    (paymentMethodOption) => paymentMethodOption.key === 'azampesa'
  );

  assert.equal(comingSoonAzampesaOption.labelKey, 'payment.instantPayment');
});

test('the event payload keeps coming-soon methods out of the selectable payment methods', () => {
  const eventConfigFromPayload = buildEventConfigFromPayload({
    slug: 'blockchain-masterclass',
    paymentMethods: ['lipanamba'],
    comingSoonPaymentMethods: ['azampesa'],
  });

  assert.deepEqual(fetchPaymentMethodKeys(eventConfigFromPayload.paymentMethods), ['lipanamba']);
  assert.deepEqual(fetchPaymentMethodKeys(eventConfigFromPayload.comingSoonPaymentMethods), [
    'azampesa',
  ]);
});

test('buildPaymentMethodOptions returns the caller fallback for an empty list', () => {
  const fallbackPaymentMethodOptions = [{ key: 'lipanamba', labelKey: 'payment.lipanamba' }];
  assert.deepEqual(buildPaymentMethodOptions([], fallbackPaymentMethodOptions), fallbackPaymentMethodOptions);
});

test('both languages label the coming-soon cards as Coming soon', () => {
  for (const languageCode of ['en', 'sw']) {
    assert.equal(resolveTranslationValue(languageCode, 'payment.instantPayment')?.length > 0, true);
    assert.equal(resolveTranslationValue(languageCode, 'payment.comingSoon')?.length > 0, true);
    assert.equal(resolveTranslationValue(languageCode, 'payment.usdt')?.length > 0, true);
  }
  assert.equal(resolveTranslationValue('en', 'payment.instantPayment'), 'Instant Payment');
});
