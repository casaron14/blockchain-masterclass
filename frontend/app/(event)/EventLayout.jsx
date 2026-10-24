'use client';

import { Suspense } from 'react';
import { LanguageProvider } from '@/context/LanguageContext';
import { EventProvider } from '@/context/EventContext';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ReferralTracker from '@/components/ReferralTracker';

export default function EventLayout({ slug, children }) {
  return (
    <EventProvider slug={slug}>
      <LanguageProvider>
        <Suspense fallback={null}>
          <ReferralTracker />
        </Suspense>
        <Header />
        <main>{children}</main>
        <Footer />
      </LanguageProvider>
    </EventProvider>
  );
}
