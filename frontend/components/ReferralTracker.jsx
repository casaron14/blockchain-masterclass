'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEvent } from '@/context/EventContext';
import { storeReferralSourceLocally } from '@/lib/referralStorage';

const UTM_SOURCE_PATTERN = /^[a-zA-Z0-9_.-]{2,100}$/;

export default function ReferralTracker() {
  const searchParams = useSearchParams();
  const { eventConfig } = useEvent();
  const eventSlug = eventConfig.slug;

  useEffect(() => {
    const utmSourceValue = searchParams.get('utm_source')?.trim() ?? '';
    if (!utmSourceValue || !UTM_SOURCE_PATTERN.test(utmSourceValue)) {
      return;
    }
    storeReferralSourceLocally(eventSlug, utmSourceValue);
  }, [searchParams, eventSlug]);

  return null;
}