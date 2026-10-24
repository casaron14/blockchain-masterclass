import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  generateReferrerUsername,
  registerReferrerInviteIdentity,
  fetchReferralSummaryReport,
  fetchReferrerByUsername,
  fetchReferredClientsForReferralCode,
} from '../services/referrerService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('TRUNCATE referrers CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

test('generateReferrerUsername builds a shareable username from the inviter name', () => {
  assert.equal(generateReferrerUsername('John Okafor'), 'john');
});

test('generateReferrerUsername falls back when the name has no usable username', () => {
  assert.equal(generateReferrerUsername('!!!'), 'referrer');
  assert.equal(generateReferrerUsername('A'), 'referrer');
});

test('registerReferrerInviteIdentity persists a referrer with a unique code', async () => {
  const referrerRecord = await registerReferrerInviteIdentity('Neema Mushi', '+255712345690');

  assert.equal(referrerRecord.referrer_name, 'Neema Mushi');
  assert.equal(referrerRecord.referrer_phone, '+255712345690');
  assert.equal(referrerRecord.referrer_code, 'neema');
});

test('registerReferrerInviteIdentity suffixes repeated usernames', async () => {
  const firstReferrer = await registerReferrerInviteIdentity('Neema Mushi', '+255712345691');
  const secondReferrer = await registerReferrerInviteIdentity('Neema Mushi', '+255712345692');
  const thirdReferrer = await registerReferrerInviteIdentity('Neema Mushi', '+255712345702');

  assert.equal(firstReferrer.referrer_code, 'neema');
  assert.equal(secondReferrer.referrer_code, 'neema2');
  assert.equal(thirdReferrer.referrer_code, 'neema3');
});

test('fetchReferralSummaryReport groups bookings by referrer with confirmed counts', async () => {
  const referrerRecord = await registerReferrerInviteIdentity('Neema Mushi', '+255712345693');

  const pendingBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Pending Attendee',
    email: 'pending@example.com',
    phone_number: '+255712345694',
    utm_source: referrerRecord.referrer_code,
  });

  const confirmedBooking = await createBookingRecordWithActiveSeatHold({
    full_name: 'Confirmed Attendee',
    email: 'confirmed@example.com',
    phone_number: '+255712345695',
    utm_source: referrerRecord.referrer_code,
  });

  await pool.query("UPDATE bookings SET status = 'confirmed' WHERE id = $1", [
    confirmedBooking.id,
  ]);

  const referralSummary = await fetchReferralSummaryReport();

  assert.equal(referralSummary.length, 1);
  assert.equal(referralSummary[0].referrer_code, referrerRecord.referrer_code);
  assert.equal(referralSummary[0].referrer_label, 'Neema Mushi');
  assert.equal(referralSummary[0].booking_count, 2);
  assert.equal(referralSummary[0].confirmed_count, 1);
  assert.equal(referralSummary[0].pending_count, 1);
  assert.ok(referralSummary[0].first_referral_at);
  assert.ok(referralSummary[0].latest_referral_at);
  assert.ok(pendingBooking.id);
});

test('fetchReferredClientsForReferralCode returns only that referrer clients with contact details', async () => {
  const referrerRecord = await registerReferrerInviteIdentity('Juma Ally', '+255712345696');

  await createBookingRecordWithActiveSeatHold({
    full_name: 'Attributed Client',
    email: 'attributed@example.com',
    phone_number: '+255712345697',
    utm_source: referrerRecord.referrer_code,
  });

  await createBookingRecordWithActiveSeatHold({
    full_name: 'Other Client',
    email: 'other@example.com',
    phone_number: '+255712345698',
    utm_source: 'ref_someone_else',
  });

  const referredClients = await fetchReferredClientsForReferralCode(
    referrerRecord.referrer_code
  );

  assert.equal(referredClients.length, 1);
  assert.equal(referredClients[0].full_name, 'Attributed Client');
  assert.equal(referredClients[0].email, 'attributed@example.com');
  assert.equal(referredClients[0].phone_number, '+255712345697');
  assert.equal(referredClients[0].referrer_name, 'Juma Ally');
  assert.equal(referredClients[0].utm_source, referrerRecord.referrer_code);
});

test('fetchReferralSummaryReport keeps an unregistered utm_source visible', async () => {
  await createBookingRecordWithActiveSeatHold({
    full_name: 'Campaign Client',
    email: 'campaign@example.com',
    phone_number: '+255712345699',
    utm_source: 'instagram_campaign',
  });

  const referralSummary = await fetchReferralSummaryReport();

  assert.equal(referralSummary.length, 1);
  assert.equal(referralSummary[0].referrer_code, 'instagram_campaign');
  assert.equal(referralSummary[0].referrer_label, 'instagram_campaign');
  assert.equal(referralSummary[0].referrer_phone, null);
  assert.equal(referralSummary[0].booking_count, 1);
});

test('fetchReferralSummaryReport lists a registered referrer before their first booking', async () => {
  const referrerRecord = await registerReferrerInviteIdentity('New Referrer', '+255712345701');

  const referralSummary = await fetchReferralSummaryReport();

  assert.equal(referralSummary.length, 1);
  assert.equal(referralSummary[0].referrer_code, referrerRecord.referrer_code);
  assert.equal(referralSummary[0].referrer_label, 'New Referrer');
  assert.equal(referralSummary[0].booking_count, 0);
  assert.equal(referralSummary[0].confirmed_count, 0);
  assert.equal(referralSummary[0].pending_count, 0);
  assert.equal(referralSummary[0].latest_referral_at, null);
});

test('fetchReferrerByUsername returns the registered referrer or null', async () => {
  const referrerRecord = await registerReferrerInviteIdentity('Asha Said', '+255712345700');

  const foundReferrer = await fetchReferrerByUsername(referrerRecord.referrer_code);
  const missingReferrer = await fetchReferrerByUsername('nobody');

  assert.equal(foundReferrer.referrer_name, 'Asha Said');
  assert.equal(missingReferrer, null);
});