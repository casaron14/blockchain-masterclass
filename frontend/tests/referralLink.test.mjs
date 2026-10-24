import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildReferralInviteUrl } from '../lib/referralLink.js';

test('buildReferralInviteUrl puts the username on the site root as ?ref=', () => {
  assert.equal(
    buildReferralInviteUrl('neema', 'https://dienacademy.com'),
    'https://dienacademy.com/?ref=neema'
  );
});

test('buildReferralInviteUrl returns a root-relative link when no origin is available', () => {
  assert.equal(buildReferralInviteUrl('neema', ''), '/?ref=neema');
});

test('buildReferralInviteUrl removes trailing slashes from the site origin', () => {
  assert.equal(
    buildReferralInviteUrl('neema', 'https://dienacademy.com/'),
    'https://dienacademy.com/?ref=neema'
  );
});

test('buildReferralInviteUrl encodes the username', () => {
  assert.equal(
    buildReferralInviteUrl('neema mushi', 'https://dienacademy.com'),
    'https://dienacademy.com/?ref=neema%20mushi'
  );
});
