// Referral links stay on the bare site root so the shared URL is as short as
// possible: siteurl/?ref=<username>. The root page forwards the ref value to
// the event page, where ReferralTracker stores it for the booking.
export function buildReferralInviteUrl(referrerUsername, siteOrigin) {
  const referralQuery = `?ref=${encodeURIComponent(referrerUsername)}`;

  if (!siteOrigin) {
    return `/${referralQuery}`;
  }

  return `${String(siteOrigin).replace(/\/+$/, '')}/${referralQuery}`;
}
