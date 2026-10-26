'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createPaymentRecord,
  lookupBookingBySearchValue,
  reactivateExpiredBooking,
  triggerTicketPdfDownload,
} from '@/lib/api';
import {
  storeBookingRecordLocally,
  storePaymentIdLocally,
} from '@/lib/bookingStorage';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import LoadingButton from '@/components/LoadingButton';
import { buildPaymentPageUrlForPaymentId } from '@/lib/siteRoutes';

const MINIMUM_BOOKING_SEARCH_VALUE_LENGTH = 2;
const MAXIMUM_BOOKING_SEARCH_VALUE_LENGTH = 120;

export default function BookingSearchLookup() {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const { slug, cryptoCurrency, cryptoNetwork, paymentMethods } = eventConfig;
  const router = useRouter();

  const [bookingSearchValue, setBookingSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [lookupResult, setLookupResult] = useState(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
  const [paymentMethodError, setPaymentMethodError] = useState(null);
  const [isPreparingPayment, setIsPreparingPayment] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [actionTone, setActionTone] = useState('info');

  async function handleBookingLookupSearchSubmit(event) {
    event.preventDefault();
    setLookupError(null);
    setLookupResult(null);
    setActionMessage(null);

    const trimmedBookingSearchValue = bookingSearchValue.trim();
    if (
      trimmedBookingSearchValue.length < MINIMUM_BOOKING_SEARCH_VALUE_LENGTH ||
      trimmedBookingSearchValue.length > MAXIMUM_BOOKING_SEARCH_VALUE_LENGTH
    ) {
      setLookupError(t('lookup.errors.invalidSearchValue'));
      return;
    }

    setIsSearching(true);
    try {
      const lookupResultPayload = await lookupBookingBySearchValue(trimmedBookingSearchValue);
      if (!lookupResultPayload) {
        setLookupError(t('lookup.errors.notFound'));
        return;
      }
      setLookupResult(lookupResultPayload);
    } catch (error) {
      const lookupErrorCode = error.responseBody?.error;
      if (lookupErrorCode === 'AMBIGUOUS_BOOKING_LOOKUP') {
        setLookupError(t('lookup.errors.multipleMatches'));
      } else if (lookupErrorCode === 'INVALID_BOOKING_SEARCH_VALUE') {
        setLookupError(error.message || t('lookup.errors.invalidSearchValue'));
      } else if (error.status === 404) {
        setLookupError(t('lookup.errors.notFound'));
      } else {
        setLookupError(error.message || t('lookup.errors.notFound'));
      }
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDownloadTicket() {
    const bookingReference = lookupResult.booking.ref;
    setActionMessage(null);
    try {
      await triggerTicketPdfDownload(bookingReference);
      setActionTone('success');
      setActionMessage(t('lookup.ticketDownloaded'));
    } catch (error) {
      setActionTone('error');
      setActionMessage(error.message || t('lookup.errors.downloadFailed'));
    }
  }

  async function preparePayment(bookingRecord) {
    const paymentMethod = selectedPaymentMethod;
    if (!paymentMethod) {
      setPaymentMethodError(t('lookup.errors.paymentMethodRequired'));
      return null;
    }
    if (lookupResult.payment?.id) {
      return lookupResult.payment.id;
    }
    const createdPaymentResult = await createPaymentRecord({
      bookingId: bookingRecord.id,
      paymentMethod,
    });
    return createdPaymentResult.payment.id;
  }

  async function handlePayNow() {
    if (!lookupResult) {
      return;
    }
    setActionMessage(null);
    setPaymentMethodError(null);
    setIsPreparingPayment(true);

    try {
      let activeBookingRecord = lookupResult.booking;

      if (activeBookingRecord.status === 'expired') {
        if (lookupResult.actions.isSoldOut) {
          setActionTone('error');
          setActionMessage(t('lookup.errors.soldOut'));
          return;
        }
        activeBookingRecord = await reactivateExpiredBooking(
          activeBookingRecord.id,
          activeBookingRecord.ref
        );
      }

      if (activeBookingRecord.status !== 'pending' && activeBookingRecord.status !== 'expired') {
        setActionTone('error');
        setActionMessage(t('lookup.errors.cannotPayCurrentStatus'));
        return;
      }

      const paymentToken = await preparePayment(activeBookingRecord);
      if (!paymentToken) {
        return;
      }

      storeBookingRecordLocally(slug, activeBookingRecord);
      storePaymentIdLocally(slug, paymentToken);

      router.push(buildPaymentPageUrlForPaymentId(paymentToken));
    } catch (error) {
      setActionTone('error');
      setActionMessage(error.message || t('lookup.errors.paymentPreparationFailed'));
    } finally {
      setIsPreparingPayment(false);
    }
  }

  const bookingStatusLabel = lookupResult
    ? t(`lookup.bookingStatus.${lookupResult.booking.status}`)
    : '';
  const paymentStatusLabel = lookupResult?.payment
    ? t(`lookup.paymentStatus.${lookupResult.payment.status}`)
    : t('lookup.noPayment');

  function renderActionResult() {
    if (!lookupResult) {
      return null;
    }

    const { actions } = lookupResult;

    return (
      <div className="lookup-result">
        <div className="lookup-summary-row">
          <span className="lookup-summary-item">
            <strong>{t('booking.fullName')}:</strong> {lookupResult.booking.full_name}
          </span>
          <span className="lookup-summary-item">
            <strong>{t('lookup.bookingStatusLabel')}:</strong> {bookingStatusLabel}
          </span>
          <span className="lookup-summary-item">
            <strong>{t('lookup.paymentStatusLabel')}:</strong> {paymentStatusLabel}
          </span>
        </div>

        {actions.isSoldOut && (
          <p className="status-message error">{t('lookup.errors.soldOut')}</p>
        )}

        {actions.canDownloadTicket && (
          <div className="lookup-ticket-ready">
            <p className="lookup-ticket-ready__note">{t('lookup.ticketReadyNote')}</p>
            <LoadingButton
              type="button"
              className="btn btn-primary"
              spinnerColor="#f2ede3"
              loadingLabel={t('loadingStates.downloadingTicket')}
              onClick={handleDownloadTicket}
            >
              {t('lookup.downloadTicket')}
            </LoadingButton>
          </div>
        )}

        {actions.canPayNow && !actions.isSoldOut && (
          <div className="lookup-pay-now">
            {!lookupResult.payment?.id && (
              <div className="method-list" role="radiogroup" aria-label={t('booking.paymentMethod')}>
                {paymentMethods.map((paymentMethodOption) => {
                  const methodKey = paymentMethodOption.key;
                  const isSelected = selectedPaymentMethod === methodKey;
                  const label = t(paymentMethodOption.labelKey, {
                    crypto: cryptoCurrency,
                    network: cryptoNetwork,
                  });

                  return (
                    <label
                      key={methodKey}
                      className={`method-card ${isSelected ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="lookup-payment-method"
                        value={methodKey}
                        checked={isSelected}
                        onChange={() => setSelectedPaymentMethod(methodKey)}
                      />
                      <span>
                        <strong>{label}</strong>
                      </span>
                    </label>
                  );
                })}
                {paymentMethodError && (
                  <span className="field-error">{paymentMethodError}</span>
                )}
              </div>
            )}

            <LoadingButton
              type="button"
              className="btn btn-primary"
              spinnerColor="#f2ede3"
              autoLoading={false}
              loading={isPreparingPayment}
              loadingLabel={t('loadingStates.preparingPayment')}
              onClick={handlePayNow}
            >
              {t('lookup.payNow')}
            </LoadingButton>
          </div>
        )}

        {!actions.canDownloadTicket && !actions.canPayNow && !actions.isSoldOut && (
          <p className="muted">{t('lookup.noActionAvailable')}</p>
        )}

        {actionMessage && (
          <p className={`status-message ${actionTone}`} role="status">
            {actionMessage}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="card">
      <h2 className="card__title">{t('lookup.title')}</h2>
      <p className="muted">{t('lookup.description')}</p>

      <form className="form" onSubmit={handleBookingLookupSearchSubmit} noValidate>
        <label className="field">
          <span>{t('lookup.searchLabel')}</span>
          <input
            type="text"
            value={bookingSearchValue}
            onChange={(event) => {
              setBookingSearchValue(event.target.value);
              setLookupError(null);
            }}
            placeholder={t('lookup.searchPlaceholder')}
            autoComplete="off"
            autoCapitalize="none"
          />
          {lookupError && <span className="field-error">{lookupError}</span>}
        </label>

        <LoadingButton
          type="submit"
          className="btn btn-secondary"
          autoLoading={false}
          loading={isSearching}
          loadingLabel={t('loadingStates.searchingBooking')}
        >
          {t('lookup.search')}
        </LoadingButton>
      </form>

      {renderActionResult()}
    </section>
  );
}