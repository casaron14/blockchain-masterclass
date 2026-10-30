'use client';

import PaymentInstructionsFlow from '@/components/PaymentInstructionsFlow';
import EventSummary from '@/components/EventSummary';
import SeatAvailabilityBanner from '@/components/SeatAvailabilityBanner';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';

export default function PaymentPageContent({ paymentId }) {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();

  return (
    <div className="booking-page">
      <div className="shell">
        <header className="page-masthead">
          <p className="page-masthead__meta">
            {eventConfig.dateLabel} · {eventConfig.location}
          </p>
          <h1 className="page-masthead__title">{t('payment.title')}</h1>
          <p className="page-masthead__lede">{t('booking.formHeading')}</p>
        </header>

        <div className="payment-layout">
          <div className="payment-main">
            <PaymentInstructionsFlow paymentId={paymentId} />
          </div>

          <aside className="booking-aside">
            <EventSummary />
            <SeatAvailabilityBanner compact />
          </aside>
        </div>
      </div>
    </div>
  );
}
