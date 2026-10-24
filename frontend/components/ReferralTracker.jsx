'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEvent } from '@/context/EventContext';
import { storeReferralSourceLocally } from '@/lib/referralStorage';

const UTM_SOURCE_PATTERN = /^[a-zA-Z0-9_.-]{2,100}$/;

// utm_source is the canonical parameter, but campaign links written by hand
// often use ref= or referrer=. Accepting them costs nothing and stops a
// referral from being lost because the link builder chose a shorter name.
const REFERRAL_SOURCE_QUERY_PARAMETER_NAMES = ['utm_source', 'ref', 'referrer'];

export default function ReferralTracker() {
  const searchParams = useSearchParams();
  const { eventConfig } = useEvent();
  const eventSlug = eventConfig.slug;

  useEffect(() => {
    const utmSourceValue =
      REFERRAL_SOURCE_QUERY_PARAMETER_NAMES.map((parameterName) =>
        searchParams.get(parameterName)?.trim() ?? ''
      ).find((candidateValue) => UTM_SOURCE_PATTERN.test(candidateValue)) ?? '';

    if (!utmSourceValue) {
      return;
    }
    storeReferralSourceLocally(eventSlug, utmSourceValue);
  }, [searchParams, eventSlug]);

  return null;
}