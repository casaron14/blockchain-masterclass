'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchBookingRecordById, fetchPaymentOverviewById } from '@/lib/api';
import { fetchStoredBookingRecord } from '@/lib/bookingStorage';

const PAYMENT_OVERVIEW_POLL_INTERVAL_MS = 5000;
const TERMINAL_PAYMENT_STATUSES = ['confirmed', 'failed', 'expired'];

// Both payment steps need the same payment record, booking record and receipt
// state, and both must notice an admin approval or an on-chain confirmation
// without the attendee reloading. Keeping the fetch and the polling here stops
// the two screens from drifting apart.
export function usePaymentOverviewPolling({ paymentId, eventSlug }) {
  const [paymentOverview, setPaymentOverview] = useState(null);
  const [bookingRecord, setBookingRecord] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadPaymentOverviewAndBooking() {
      try {
        const loadedPaymentOverview = await fetchPaymentOverviewById(paymentId);
        if (isCancelled) {
          return;
        }
        setPaymentOverview(loadedPaymentOverview);

        let fetchedBookingRecord = null;
        if (loadedPaymentOverview.payment?.booking_id) {
          fetchedBookingRecord = await fetchBookingRecordById(
            loadedPaymentOverview.payment.booking_id
          ).catch(() => null);
        }
        if (isCancelled) {
          return;
        }
        setBookingRecord(fetchedBookingRecord ?? fetchStoredBookingRecord(eventSlug) ?? null);
      } catch (error) {
        if (!isCancelled) {
          setLoadError(error.message);
        }
      }
    }

    loadPaymentOverviewAndBooking();

    return () => {
      isCancelled = true;
    };
  }, [paymentId, eventSlug]);

  const paymentStatus = paymentOverview?.payment?.status;

  useEffect(() => {
    if (!paymentStatus || TERMINAL_PAYMENT_STATUSES.includes(paymentStatus)) {
      return undefined;
    }

    const pollTimer = setInterval(() => {
      fetchPaymentOverviewById(paymentId)
        .then((polledPaymentOverview) => setPaymentOverview(polledPaymentOverview))
        .catch(() => {
          // A failed poll must not replace the screen the attendee is reading;
          // the next tick tries again.
        });
    }, PAYMENT_OVERVIEW_POLL_INTERVAL_MS);

    return () => clearInterval(pollTimer);
  }, [paymentId, paymentStatus]);

  const refreshPaymentOverview = useCallback(async () => {
    const refreshedPaymentOverview = await fetchPaymentOverviewById(paymentId);
    setPaymentOverview(refreshedPaymentOverview);
    return refreshedPaymentOverview;
  }, [paymentId]);

  // Uploading a receipt can extend the seat hold, so the countdown needs the
  // booking record refreshed as well as the payment record.
  const refreshBookingRecord = useCallback(async () => {
    const bookingId = paymentOverview?.payment?.booking_id;
    if (!bookingId) {
      return null;
    }
    const refreshedBookingRecord = await fetchBookingRecordById(bookingId).catch(() => null);
    if (refreshedBookingRecord) {
      setBookingRecord(refreshedBookingRecord);
    }
    return refreshedBookingRecord;
  }, [paymentOverview?.payment?.booking_id]);

  return {
    paymentOverview,
    bookingRecord,
    loadError,
    refreshPaymentOverview,
    refreshBookingRecord,
  };
}
