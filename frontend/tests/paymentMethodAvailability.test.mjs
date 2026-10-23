import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEventConfigFromPayload,
  buildPaymentMethodOptions,
  defaultEventConfig,
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

test('only Lipa Namba is sellable, so the booking form cannot create a crypto or AzamPay payment', () => {
  assert.deepEqual(fetchPaymentMethodKeys(defaultEventConfig.paymentMethods), ['lipanamba']);
});

test('crypto and AzamPay are advertised as coming soon instead of being selectable', () => {
  assert.deepEqual(fetchPaymentMethodKeys(defaultEventConfig.comingSoonPaymentMethods), [
    'azampesa',
    'usdt_bep20',
  ]);
  assert.equal(
    defaultEventConfig.comingSoonPaymentMethods[0].labelKey,
    'payment.instantPayment'
  );
});

test('the event payload keeps coming-soon methods out of the selectable payment methods', () => {
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

test('a payload without coming-soon methods still shows the default coming-soon cards', () => {
  const eventConfigFromPayload = buildEventConfigFromPayload({
    slug: 'blockchain-masterclass',
    paymentMethods: ['lipanamba'],
  });

  assert.deepEqual(
    fetchPaymentMethodKeys(eventConfigFromPayload.comingSoonPaymentMethods),
    fetchPaymentMethodKeys(defaultEventConfig.comingSoonPaymentMethods)
  );
});

test('buildPaymentMethodOptions returns the caller fallback for an empty list', () => {
  const fallbackPaymentMethodOptions = [{ key: 'lipanamba', labelKey: 'payment.lipanamba' }];
  assert.deepEqual(buildPaymentMethodOptions([], fallbackPaymentMethodOptions), fallbackPaymentMethodOptions);
});

test('both languages label the muted methods as Instant Payment and Coming soon', () => {
  for (const languageCode of ['en', 'sw']) {
    assert.equal(resolveTranslationValue(languageCode, 'payment.instantPayment')?.length > 0, true);
    assert.equal(resolveTranslationValue(languageCode, 'payment.comingSoon')?.length > 0, true);
  }
  assert.equal(resolveTranslationValue('en', 'payment.instantPayment'), 'Instant Payment');
});
