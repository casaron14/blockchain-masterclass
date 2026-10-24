import pool from '../config/db.js';

const REFERRER_USERNAME_MAX_BASE_LENGTH = 20;
const REFERRER_USERNAME_MIN_LENGTH = 2;
const REFERRER_USERNAME_FALLBACK = 'referrer';
const REFERRER_USERNAME_MAX_CREATION_ATTEMPTS = 50;

function buildReferrerUsernameBase(referrerName) {
  const referrerFirstNameSlug = String(referrerName || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z0-9]/g, '')
    .slice(0, REFERRER_USERNAME_MAX_BASE_LENGTH);

  return referrerFirstNameSlug.length >= REFERRER_USERNAME_MIN_LENGTH
    ? referrerFirstNameSlug
    : REFERRER_USERNAME_FALLBACK;
}

// The referral username is the human-readable handle the referrer shares as
// siteurl/?ref=<username>. It is derived from the name so the admin does not
// have to invent or type an extra identifier.
export function generateReferrerUsername(referrerName) {
  return buildReferrerUsernameBase(referrerName);
}

function buildReferrerUsernameCandidate(baseUsername, creationAttemptIndex) {
  if (creationAttemptIndex === 0) {
    return baseUsername;
  }
  return `${baseUsername}${creationAttemptIndex + 1}`;
}

export async function registerReferrerInviteIdentity(referrerName, referrerPhone) {
  const baseUsername = generateReferrerUsername(referrerName);

  for (
    let creationAttemptIndex = 0;
    creationAttemptIndex < REFERRER_USERNAME_MAX_CREATION_ATTEMPTS;
    creationAttemptIndex += 1
  ) {
    const referrerUsername = buildReferrerUsernameCandidate(
      baseUsername,
      creationAttemptIndex
    );

    try {
      const result = await pool.query(
        `INSERT INTO referrers (referrer_code, referrer_name, referrer_phone)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [referrerUsername, referrerName, referrerPhone]
      );
      return result.rows[0];
    } catch (error) {
      if (error.code !== '23505') {
        throw error;
      }
    }
  }

  throw new Error('Could not generate a unique referral username for this referrer');
}

export async function fetchReferrerByUsername(referrerUsername) {
  const result = await pool.query(
    `SELECT * FROM referrers WHERE referrer_code = $1`,
    [referrerUsername]
  );
  return result.rows[0] ?? null;
}

// One row per referral source. Registered referrers appear even before their
// first booking so an admin can always retrieve a link they created. A source
// that has bookings but no referrers row is still reported: it is a campaign
// link or a code an admin typed by hand, and hiding it would make the total in
// this report disagree with the bookings table.
export async function fetchReferralSummaryReport() {
  const result = await pool.query(
    `WITH booking_attribution AS (
       SELECT
         b.utm_source AS referral_code,
         COUNT(*)::INT AS booking_count,
         COUNT(*) FILTER (WHERE b.status = 'confirmed')::INT AS confirmed_count,
         COUNT(*) FILTER (WHERE b.status = 'pending')::INT AS pending_count,
         MIN(b.created_at) AS first_referral_at,
         MAX(b.created_at) AS latest_referral_at
       FROM bookings b
       WHERE b.utm_source IS NOT NULL AND b.utm_source <> ''
       GROUP BY b.utm_source
     )
     SELECT
       COALESCE(r.referrer_name, ba.referral_code) AS referrer_label,
       COALESCE(r.referrer_code, ba.referral_code) AS referrer_code,
       r.referrer_phone,
       COALESCE(ba.booking_count, 0) AS booking_count,
       COALESCE(ba.confirmed_count, 0) AS confirmed_count,
       COALESCE(ba.pending_count, 0) AS pending_count,
       ba.first_referral_at,
       ba.latest_referral_at
     FROM referrers r
     FULL OUTER JOIN booking_attribution ba
       ON ba.referral_code = r.referrer_code
     ORDER BY confirmed_count DESC, booking_count DESC, latest_referral_at DESC NULLS LAST`
  );
  return result.rows;
}

// The client list an admin sends back to the referrer. It contains only the
// booking contact details the campaign is measured on, never payment or
// blockchain information.
export async function fetchReferredClientsForReferralCode(referrerCode) {
  const result = await pool.query(
    `SELECT
       b.id,
       b.ref,
       b.full_name,
       b.email,
       b.phone_number,
       b.status,
       b.utm_source,
       b.created_at,
       COALESCE(r.referrer_name, b.utm_source) AS referrer_name,
       p.status AS payment_status
     FROM bookings b
     LEFT JOIN referrers r ON r.referrer_code = b.utm_source
     LEFT JOIN payments p ON p.booking_id = b.id
     WHERE b.utm_source = $1
     ORDER BY b.created_at DESC`,
    [referrerCode]
  );

  return result.rows;
}

export async function fetchReferredClientCountForReferralCode(referrerCode) {
  const result = await pool.query(
    `SELECT COUNT(*)::INT AS referred_client_count
       FROM bookings
      WHERE utm_source = $1`,
    [referrerCode]
  );
  return result.rows[0].referred_client_count;
}
