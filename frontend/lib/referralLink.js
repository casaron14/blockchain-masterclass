// Referral links stay on the bare site root so the shared URL is as short as
// possible: siteurl/?ref=<username>. The root page is the event page itself, so
// ReferralTracker stores the value for the booking without a redirect hop.
export function buildReferralInviteUrl(referrerUsername, siteOrigin) {
  const referralQuery = `?ref=${encodeURIComponent(referrerUsername)}`;

  if (!siteOrigin) {
    return `/${referralQuery}`;
  }

  return `${String(siteOrigin).replace(/\/+$/, '')}/${referralQuery}`;
}
