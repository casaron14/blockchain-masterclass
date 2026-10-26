'use client';

import BookingForm from '@/components/BookingForm';
import BookingSearchLookup from '@/components/BookingSearchLookup';
import EventSummary from '@/components/EventSummary';
import SeatAvailabilityBanner from '@/components/SeatAvailabilityBanner';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';

export default function BookingPage() {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();

  return (
    <div className="booking-page">
      <div className="shell">
        <header className="page-masthead">
          <p className="page-masthead__meta">
            {eventConfig.dateLabel} · {eventConfig.location}
          </p>
          <h1 className="page-masthead__title">{t('booking.title')}</h1>
          <p className="page-masthead__lede">{t('booking.formHeading')}</p>
        </header>

        <div className="booking-layout">
          <aside className="booking-aside">
            <EventSummary />
            <SeatAvailabilityBanner compact />
            <p className="booking-aside__note">
              {t('booking.holdNote', { holdMinutes: eventConfig.seatHoldMinutes })}
            </p>
          </aside>

          <div className="booking-main">
            <section className="paper-sheet">
              <h2 className="sheet-heading">{t('booking.attendeeHeading')}</h2>
              <BookingForm />
            </section>

            <BookingSearchLookup />
          </div>
        </div>
      </div>
    </div>
  );
}
