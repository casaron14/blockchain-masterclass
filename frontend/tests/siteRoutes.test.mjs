import test from 'node:test';
import assert from 'node:assert/strict';

import { PRIMARY_EVENT_SLUG } from '../../shared/eventConfig.js';
import {
  BACK_OFFICE_HOME_URL,
  BOOKING_PAGE_URL,
  EVENT_HOME_URL,
  buildBookingPageUrl,
  buildEventHomeSectionUrlForSectionId,
  buildEventHomeUrl,
  buildPaymentPageUrlForPaymentId,
  buildSuccessPageUrlForReferenceCode,
} from '../lib/siteRoutes.js';

const LEGACY_EVENT_PATH_PREFIX = `/${PRIMARY_EVENT_SLUG}`;

test('the public event URLs live on the apex domain and never repeat the event slug', () => {
  const publicUrls = [
    buildEventHomeUrl(),
    buildBookingPageUrl(),
    buildPaymentPageUrlForPaymentId('payment-123'),
    buildSuccessPageUrlForReferenceCode('ABC123'),
    buildEventHomeSectionUrlForSectionId('programme'),
  ];

  for (const publicUrl of publicUrls) {
    assert.equal(
      publicUrl === LEGACY_EVENT_PATH_PREFIX ||
        publicUrl.startsWith(`${LEGACY_EVENT_PATH_PREFIX}/`),
      false,
      `${publicUrl} must not be nested under the old event slug`
    );
  }
});

test('the event home is the site root', () => {
  assert.equal(EVENT_HOME_URL, '/');
  assert.equal(buildEventHomeUrl(), '/');
});

test('the booking page is served directly below the root', () => {
  assert.equal(BOOKING_PAGE_URL, '/book');
  assert.equal(buildBookingPageUrl(), '/book');
});

test('the back office link stays at /admin', () => {
  assert.equal(BACK_OFFICE_HOME_URL, '/admin');
});

test('a payment page URL carries the payment id below the root', () => {
  assert.equal(buildPaymentPageUrlForPaymentId('9f2c1a7b'), '/pay/9f2c1a7b');
});

test('a success page URL carries the booking reference below the root', () => {
  assert.equal(buildSuccessPageUrlForReferenceCode('MASTER123'), '/success/MASTER123');
});

test('an event section link targets a hash on the root page', () => {
  assert.equal(buildEventHomeSectionUrlForSectionId('admission'), '/#admission');
});

test('dynamic URL segments are encoded instead of injected verbatim', () => {
  assert.equal(buildPaymentPageUrlForPaymentId('id/with space'), '/pay/id%2Fwith%20space');
  assert.equal(
    buildSuccessPageUrlForReferenceCode('ref#fragment'),
    '/success/ref%23fragment'
  );
});
