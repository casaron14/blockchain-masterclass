import { redirect } from 'next/navigation';
import { DEFAULT_EVENT_SLUG } from '@/lib/eventConfig';

const FORWARDED_REFERRAL_SOURCE_PARAMETER_NAMES = ['utm_source', 'ref', 'referrer'];

function readForwardedReferralSource(searchParams) {
  for (const parameterName of FORWARDED_REFERRAL_SOURCE_PARAMETER_NAMES) {
    const rawParameterValue = searchParams?.[parameterName];
    const parameterValue = Array.isArray(rawParameterValue)
      ? rawParameterValue[0]
      : rawParameterValue;

    if (typeof parameterValue === 'string' && parameterValue.trim() !== '') {
      return parameterValue.trim();
    }
  }
  return null;
}

// A campaign link can point at the bare domain. Redirecting to the event slug
// must carry the tracking parameter across, otherwise a referral arriving at
// "/" is silently lost before the tracker ever runs.
export default async function HomePage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const referralSourceValue = readForwardedReferralSource(resolvedSearchParams);
  const referralQuery = referralSourceValue
    ? `?utm_source=${encodeURIComponent(referralSourceValue)}`
    : '';

  redirect(`/${DEFAULT_EVENT_SLUG}${referralQuery}`);
}
