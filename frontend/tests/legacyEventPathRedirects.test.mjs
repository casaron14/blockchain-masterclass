import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_EVENT_PATH_PREFIX,
  buildLegacyEventRedirectPath,
} from '../lib/legacyEventPathRedirects.js';
import { PRIMARY_EVENT_SLUG } from '../../shared/eventConfig.js';

test('the legacy event home redirects to the root event page', () => {
  assert.equal(LEGACY_EVENT_PATH_PREFIX, `/${PRIMARY_EVENT_SLUG}`);
  assert.equal(buildLegacyEventRedirectPath('/blockchain-masterclass'), '/');
});

test('a legacy sub-page redirects to the same page below the root', () => {
  assert.equal(buildLegacyEventRedirectPath('/blockchain-masterclass/book'), '/book');
  assert.equal(
    buildLegacyEventRedirectPath('/blockchain-masterclass/pay/payment-123'),
    '/pay/payment-123'
  );
  assert.equal(
    buildLegacyEventRedirectPath('/blockchain-masterclass/success/ABC123'),
    '/success/ABC123'
  );
});

test('unrelated addresses are left alone instead of being redirected', () => {
  assert.equal(buildLegacyEventRedirectPath('/'), null);
  assert.equal(buildLegacyEventRedirectPath('/book'), null);
  assert.equal(buildLegacyEventRedirectPath('/admin'), null);
  assert.equal(buildLegacyEventRedirectPath('/blockchain-masterclass-archive'), null);
  assert.equal(buildLegacyEventRedirectPath('/blockchain-masterclass-archive/book'), null);
});
