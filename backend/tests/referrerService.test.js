import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';

import {
  generateReferrerInviteCode,
  registerReferrerInviteIdentity,
  fetchReferralSummaryReport,
} from '../services/referrerService.js';

import { createBookingRecordWithActiveSeatHold } from '../services/bookingService.js';

async function resetDatabaseState() {
  await pool.query('TRUNCATE bookings CASCADE');
  await pool.query('TRUNCATE referrers CASCADE');
  await pool.query('UPDATE seat_capacity SET confirmed_count = 0 WHERE id = 1');
}

beforeEach(resetDatabaseState);

test('generateReferrerInviteCode builds a shareable code from the inviter name', () => {
  const referrerCode = generateReferrerInviteCode('John Okafor');
  assert.match(referrerCode, /^ref_john_[a-z0-9]{4}$/);
});

test('registerReferrerInviteIdentity persists a referrer with a unique code', async () => {
  const referrerRecord = await registerReferrerInviteIdentity('Neema Mushi', '+255712345690');

  assert.equal(referrerRecord.referrer_name, 'Neema Mushi');
  assert.equal(referrerRecord.referrer_phone, '+255712345690');
  assert.match(referrerRecord.referrer_code, /^ref_neema_[a-z0-9]{4}$/);
});

test('registerReferrerInviteIdentity produces distinct codes for repeated inviter names', async () => {
  const firstReferrer = await registerReferrerInviteIdentity('Neema Mushi', '+255712345691');
  const secondReferrer = await registerReferrerInviteIdentity('Neema Mushi', '+255712345692');

  assert.notEqual(firstReferrer.referrer_code, secondReferrer.referrer_code);
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
  assert.ok(pendingBooking.id);
});