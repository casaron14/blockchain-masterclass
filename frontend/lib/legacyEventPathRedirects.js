import { PRIMARY_EVENT_SLUG } from '../../shared/eventConfig.js';

// The event used to live under /<slug>. Links printed on tickets, referral
// campaigns and WhatsApp messages already point there, so the old address keeps
// working as a permanent redirect to the same page on the apex domain.
export const LEGACY_EVENT_PATH_PREFIX = `/${PRIMARY_EVENT_SLUG}`;

export function buildLegacyEventRedirectPath(requestedPathname) {
  if (requestedPathname === LEGACY_EVENT_PATH_PREFIX) {
    return '/';
  }

  if (requestedPathname.startsWith(`${LEGACY_EVENT_PATH_PREFIX}/`)) {
    return requestedPathname.slice(LEGACY_EVENT_PATH_PREFIX.length);
  }

  return null;
}
