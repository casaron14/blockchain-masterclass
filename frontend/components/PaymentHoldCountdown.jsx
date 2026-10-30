'use client';

import { useEffect, useState } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { formatPaymentHoldCountdown } from '@/lib/paymentHoldCountdown';

const URGENT_COUNTDOWN_THRESHOLD_MILLISECONDS = 2 * 60 * 1000;

export default function PaymentHoldCountdown({
  bookingExpiresAtMilliseconds,
  isPaymentConfirmed,
}) {
  const { t } = useLanguage();
  const [remainingMilliseconds, setRemainingMilliseconds] = useState(null);

  useEffect(() => {
    if (!bookingExpiresAtMilliseconds || isPaymentConfirmed) {
      return undefined;
    }

    function updateRemainingTime() {
      setRemainingMilliseconds(bookingExpiresAtMilliseconds - Date.now());
    }

    updateRemainingTime();
    const countdownTimer = setInterval(updateRemainingTime, 1000);

    return () => clearInterval(countdownTimer);
  }, [bookingExpiresAtMilliseconds, isPaymentConfirmed]);

  if (!bookingExpiresAtMilliseconds || isPaymentConfirmed) {
    return null;
  }

  const isCountdownUrgent =
    remainingMilliseconds !== null &&
    remainingMilliseconds <= URGENT_COUNTDOWN_THRESHOLD_MILLISECONDS;
  const isHoldExpired = remainingMilliseconds !== null && remainingMilliseconds <= 0;

  return (
    <>
      <div className={`hold-countdown ${isCountdownUrgent ? 'warning' : ''}`}>
        <span>{t('payment.timeRemaining')}</span>
        <strong>
          {formatPaymentHoldCountdown(
            remainingMilliseconds ?? bookingExpiresAtMilliseconds - Date.now()
          )}
        </strong>
      </div>

      {isHoldExpired && (
        <p className="status-message error" role="status">
          {t('payment.statusExpired')}
        </p>
      )}
    </>
  );
}
