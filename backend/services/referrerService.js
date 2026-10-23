import pool from '../config/db.js';
import crypto from 'node:crypto';

const INVITE_CODE_PREFIX = 'ref';
const INVITE_CODE_RANDOM_SUFFIX_LENGTH = 4;
const INVITE_CODE_MAX_BASE_LENGTH = 12;

export function generateReferrerInviteCode(inviterName) {
  const nameBase = String(inviterName || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z0-9]/g, '')
    .slice(0, INVITE_CODE_MAX_BASE_LENGTH);

  const randomSuffix = generateRandomInviteCodeSuffix(INVITE_CODE_RANDOM_SUFFIX_LENGTH);

  return [INVITE_CODE_PREFIX, nameBase, randomSuffix].filter(Boolean).join('_');
}

function generateRandomInviteCodeSuffix(length) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export async function registerReferrerInviteIdentity(referrerName, referrerPhone) {
  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
    const referrerCode = generateReferrerInviteCode(referrerName);

    try {
      const result = await pool.query(
        `INSERT INTO referrers (referrer_code, referrer_name, referrer_phone)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [referrerCode, referrerName, referrerPhone]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code !== '23505') {
        throw error;
      }
    }
  }

  throw new Error('Could not generate a unique invite code for this referrer');
}

export async function fetchReferralSummaryReport() {
  const result = await pool.query(
    `SELECT
       COALESCE(r.referrer_name, b.utm_source) AS referrer_label,
       r.referrer_code,
       r.referrer_phone,
       COUNT(b.id)::INT AS booking_count,
       COUNT(*) FILTER (WHERE b.status = 'confirmed')::INT AS confirmed_count
     FROM bookings b
     LEFT JOIN referrers r ON r.referrer_code = b.utm_source
     WHERE b.utm_source IS NOT NULL AND b.utm_source <> ''
     GROUP BY referrer_label, r.referrer_code, r.referrer_phone
     ORDER BY confirmed_count DESC, booking_count DESC`
  );
  return result.rows;
}