'use client';

import PaymentConfirmationFlow from '@/components/PaymentConfirmationFlow';
import EventSummary from '@/components/EventSummary';
import SeatAvailabilityBanner from '@/components/SeatAvailabilityBanner';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';

export default function PaymentConfirmationPageContent({ paymentId }) {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();

  return (
    <div className="booking-page">
      <div className="shell">
        <header className="page-masthead">
          <p className="page-masthead__meta">
            {eventConfig.dateLabel} · {eventConfig.location}
          </p>
          <h1 className="page-masthead__title">{t('payment.confirmPageTitle')}</h1>
          <p className="page-masthead__lede">{t('payment.confirmPageLede')}</p>
        </header>

        <div className="payment-layout">
          <div className="payment-main">
            <PaymentConfirmationFlow paymentId={paymentId} />
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
