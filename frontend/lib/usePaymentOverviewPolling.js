'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchPaymentOverviewByPublicToken } from '@/lib/api';
import { isPaymentStatusTerminal } from '@/lib/paymentStatus';

const PAYMENT_OVERVIEW_POLL_INTERVAL_MS = 5000;

// Both payment steps need the same payment record, booking record and receipt
// state, and both must notice an admin approval or an on-chain confirmation
// without the attendee reloading. The public token is the only credential the
// page has, so the booking projection arrives with the payment overview
// instead of a second lookup by the internal booking id.
export function usePaymentOverviewPolling({ paymentPublicToken }) {
  const [paymentOverview, setPaymentOverview] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const bookingRecord = paymentOverview?.booking ?? null;

  useEffect(() => {
    let isCancelled = false;

    async function loadPaymentOverview() {
      try {
        const loadedPaymentOverview =
          await fetchPaymentOverviewByPublicToken(paymentPublicToken);
        if (!isCancelled) {
          setPaymentOverview(loadedPaymentOverview);
        }
      } catch (error) {
        if (!isCancelled) {
          setLoadError(error.message);
        }
      }
    }

    loadPaymentOverview();

    return () => {
      isCancelled = true;
    };
  }, [paymentPublicToken]);

  const paymentStatus = paymentOverview?.payment?.status;

  useEffect(() => {
    if (!paymentStatus || isPaymentStatusTerminal(paymentStatus)) {
      return undefined;
    }

    const pollTimer = setInterval(() => {
      fetchPaymentOverviewByPublicToken(paymentPublicToken)
        .then((polledPaymentOverview) => setPaymentOverview(polledPaymentOverview))
        .catch(() => {
          // A failed poll must not replace the screen the attendee is reading;
          // the next tick tries again.
        });
    }, PAYMENT_OVERVIEW_POLL_INTERVAL_MS);

    return () => clearInterval(pollTimer);
  }, [paymentPublicToken, paymentStatus]);

  const refreshPaymentOverview = useCallback(async () => {
    const refreshedPaymentOverview =
      await fetchPaymentOverviewByPublicToken(paymentPublicToken);
    setPaymentOverview(refreshedPaymentOverview);
    return refreshedPaymentOverview;
  }, [paymentPublicToken]);

  // Uploading a receipt can extend the seat hold, so the countdown needs the
  // booking projection refreshed as well as the payment record.
  const refreshBookingRecord = useCallback(async () => {
    const refreshedPaymentOverview =
      await fetchPaymentOverviewByPublicToken(paymentPublicToken).catch(() => null);
    if (refreshedPaymentOverview) {
      setPaymentOverview(refreshedPaymentOverview);
    }
    return refreshedPaymentOverview?.booking ?? null;
  }, [paymentPublicToken]);

  return {
    paymentOverview,
    bookingRecord,
    loadError,
    refreshPaymentOverview,
    refreshBookingRecord,
  };
}
