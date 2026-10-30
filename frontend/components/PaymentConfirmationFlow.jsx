'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  triggerTicketPdfDownload,
  uploadLipaNambaPaymentReceipt,
} from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import { SUPPORTED_PAYMENT_METHODS } from '@/lib/eventConfig';
import { formatLocalPrice } from '@/lib/eventFormat';
import { usePaymentOverviewPolling } from '@/lib/usePaymentOverviewPolling';
import { buildBookingPageUrl, buildPaymentPageUrlForPaymentId } from '@/lib/siteRoutes';
import LoadingButton from '@/components/LoadingButton';
import PaymentHoldCountdown from '@/components/PaymentHoldCountdown';
import PaymentLoadingSkeleton from '@/components/PaymentLoadingSkeleton';
import HairlineLoadingIndicator from '@/components/HairlineLoadingIndicator';

// Serverless hosts (Vercel) refuse a request body above 4.5 MB before it ever
// reaches the API, so the client must never offer to upload more than the
// backend will accept.
const MAX_RECEIPT_FILE_SIZE_BYTES = 4 * 1024 * 1024;
const SUPPORTED_RECEIPT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const TERMINAL_PAYMENT_STATUSES = ['confirmed', 'failed', 'expired'];

export default function PaymentConfirmationFlow({ paymentId }) {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const { slug, currency, ticketPrice, cryptoCurrency, cryptoNetwork } = eventConfig;

  const {
    paymentOverview,
    bookingRecord,
    loadError,
    refreshPaymentOverview,
    refreshBookingRecord,
  } = usePaymentOverviewPolling({ paymentId, eventSlug: slug });

  const [selectedReceiptFile, setSelectedReceiptFile] = useState(null);
  const [receiptUploadError, setReceiptUploadError] = useState(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [isOfflineSeatHoldActive, setIsOfflineSeatHoldActive] = useState(null);
  const [isDownloadingTicket, setIsDownloadingTicket] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const receiptFileInputRef = useRef(null);

  const paymentRecord = paymentOverview?.payment ?? null;
  const offlinePaymentReceipt = paymentOverview?.offlineReceipt ?? null;
  const settlementSummary = paymentOverview?.settlement ?? null;

  const attendeeFullName = bookingRecord?.full_name ?? '';
  const bookingReferenceCode = bookingRecord?.ref ?? '';
  const parsedBookingExpiresAtMs = bookingRecord?.expires_at
    ? Date.parse(bookingRecord.expires_at)
    : null;
  const bookingExpiresAtMs = Number.isNaN(parsedBookingExpiresAtMs)
    ? null
    : parsedBookingExpiresAtMs;

  const paymentStatusValue = paymentRecord?.status;
  const paymentMethod = paymentRecord?.payment_method;
  const isPaymentConfirmed = paymentStatusValue === 'confirmed';
  const isPaymentStatusTerminal = TERMINAL_PAYMENT_STATUSES.includes(paymentStatusValue);

  const isOfflinePaymentAwaitingReview =
    paymentMethod === SUPPORTED_PAYMENT_METHODS.lipanamba &&
    offlinePaymentReceipt?.status === 'submitted' &&
    !isPaymentStatusTerminal;

  const canUploadOfflinePaymentReceipt =
    paymentMethod === SUPPORTED_PAYMENT_METHODS.lipanamba &&
    paymentStatusValue !== 'confirmed' &&
    offlinePaymentReceipt?.status !== 'approved' &&
    (offlinePaymentReceipt?.status !== 'submitted' || isPaymentStatusTerminal);

  function handleReceiptFileSelection(event) {
    const receiptFile = event.target.files?.[0] ?? null;
    setReceiptUploadError(null);

    if (!receiptFile) {
      setSelectedReceiptFile(null);
      return;
    }

    if (receiptFile.size > MAX_RECEIPT_FILE_SIZE_BYTES) {
      setSelectedReceiptFile(null);
      setReceiptUploadError(t('payment.lipanambaReceiptTooLarge'));
      return;
    }

    if (receiptFile.type && !SUPPORTED_RECEIPT_MIME_TYPES.includes(receiptFile.type)) {
      setSelectedReceiptFile(null);
      setReceiptUploadError(t('payment.lipanambaReceiptInvalidType'));
      return;
    }

    setSelectedReceiptFile(receiptFile);
  }

  async function handleUploadReceipt(event) {
    event.preventDefault();

    if (!selectedReceiptFile) {
      setReceiptUploadError(t('payment.lipanambaReceiptMissing'));
      return;
    }

    setReceiptUploadError(null);
    setIsUploadingReceipt(true);

    try {
      const uploadResult = await uploadLipaNambaPaymentReceipt(
        paymentId,
        selectedReceiptFile,
        bookingReferenceCode
      );
      setIsOfflineSeatHoldActive(uploadResult.isSeatHoldActive !== false);
      setSelectedReceiptFile(null);
      if (receiptFileInputRef.current) {
        receiptFileInputRef.current.value = '';
      }
      await Promise.all([refreshPaymentOverview(), refreshBookingRecord()]);
    } catch (error) {
      setReceiptUploadError(error.message || t('payment.genericError'));
    } finally {
      setIsUploadingReceipt(false);
    }
  }

  async function handleDownloadTicket() {
    if (!bookingReferenceCode) {
      return;
    }
    setIsDownloadingTicket(true);
    setDownloadError(null);
    try {
      await triggerTicketPdfDownload(bookingReferenceCode);
    } catch (error) {
      setDownloadError(error.message || t('payment.downloadTicketFailed'));
    } finally {
      setIsDownloadingTicket(false);
    }
  }

  if (loadError) {
    return <p className="error-banner">{loadError}</p>;
  }

  if (!paymentRecord) {
    return <PaymentLoadingSkeleton statusLabel={t('loadingStates.loadingPayment')} />;
  }

  return (
    <section className="card">
      <PaymentHoldCountdown
        bookingExpiresAtMilliseconds={bookingExpiresAtMs}
        isPaymentConfirmed={isPaymentConfirmed}
      />

      <h2 className="card__title">{t('payment.confirmPageTitle')}</h2>
      <p className="muted">{t('payment.confirmPageLede')}</p>

      {(attendeeFullName || bookingReferenceCode) && (
        <div className="detail-list payment-attendee-details">
          {attendeeFullName && (
            <p>
              <strong>{t('payment.attendeeLabel')}:</strong> {attendeeFullName}
            </p>
          )}
          {bookingReferenceCode && (
            <p>
              <strong>{t('payment.bookingReferenceLabel')}:</strong>{' '}
              <code className="payment-booking-reference-code">{bookingReferenceCode}</code>
            </p>
          )}
        </div>
      )}

      {isPaymentConfirmed && (
        <div className="payment-flow">
          <p className="status-message success" role="status">
            {t('payment.confirmedNotice')}
          </p>
          <p className="muted">{t('payment.confirmedTicketNote')}</p>
          <LoadingButton
            type="button"
            className="btn btn-primary"
            spinnerColor="#f2ede3"
            autoLoading={false}
            loading={isDownloadingTicket}
            loadingLabel={t('loadingStates.downloadingTicket')}
            disabled={!bookingReferenceCode}
            onClick={handleDownloadTicket}
          >
            {t('payment.downloadTicket')}
          </LoadingButton>
          {downloadError && (
            <p className="field-error" role="alert">
              {downloadError}
            </p>
          )}
        </div>
      )}

      {!isPaymentConfirmed && paymentMethod === SUPPORTED_PAYMENT_METHODS.lipanamba && (
        <div className="payment-flow">
          {isOfflinePaymentAwaitingReview && (
            <p className="status-message info" role="status">
              {t('payment.lipanambaReceiptAwaitingReview')}
            </p>
          )}

          {offlinePaymentReceipt?.status === 'rejected' && (
            <p className="status-message error" role="alert">
              {t('payment.lipanambaReceiptRejected')}
            </p>
          )}

          {isOfflinePaymentAwaitingReview && isOfflineSeatHoldActive === false && (
            <p className="status-message error" role="alert">
              {t('payment.lipanambaSeatHoldUnavailable')}
            </p>
          )}

          {canUploadOfflinePaymentReceipt && (
            <>
              <p>
                {t('payment.confirmReceiptPrompt', {
                  currency,
                  price: formatLocalPrice(ticketPrice),
                })}
              </p>

              <form className="form" onSubmit={handleUploadReceipt} noValidate>
                <label className="field">
                  <span>{t('payment.lipanambaReceiptLabel')}</span>
                  <input
                    ref={receiptFileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={handleReceiptFileSelection}
                  />
                  <span className="muted">{t('payment.lipanambaReceiptHelp')}</span>
                </label>

                {selectedReceiptFile && <p className="muted">{selectedReceiptFile.name}</p>}

                {receiptUploadError && (
                  <p className="field-error" role="alert">
                    {receiptUploadError}
                  </p>
                )}

                <LoadingButton
                  type="submit"
                  className="btn btn-primary"
                  spinnerColor="#f2ede3"
                  autoLoading={false}
                  loading={isUploadingReceipt}
                  loadingLabel={t('loadingStates.uploadingReceipt')}
                >
                  {t('payment.lipanambaUploadReceipt')}
                </LoadingButton>
              </form>
            </>
          )}
        </div>
      )}

      {!isPaymentConfirmed && paymentMethod === SUPPORTED_PAYMENT_METHODS.usdt_bep20 && (
        <div className="payment-flow">
          <div className="qr-code-loading" role="status" aria-live="polite">
            <HairlineLoadingIndicator color="#a34a25" size={18} />
            <span className="qr-code-loading__label">
              {t('payment.waitingForBlockchainConfirmation', {
                crypto: cryptoCurrency,
                network: cryptoNetwork,
              })}
            </span>
          </div>

          {settlementSummary?.observedTransferCount > 0 && (
            <p className="status-message info" role="status">
              {t('payment.blockchainTransferObserved', {
                amount: settlementSummary.observedAmountUsdt,
                crypto: cryptoCurrency,
              })}
            </p>
          )}

          <p className="status-message info">{t('payment.automaticCheck')}</p>
        </div>
      )}

      {paymentStatusValue === 'failed' && (
        <p className="status-message error" role="status">
          {t('payment.paymentFailed')}
        </p>
      )}

      <div className="payment-next-step">
        <Link
          href={buildPaymentPageUrlForPaymentId(paymentId)}
          className="btn btn-secondary"
        >
          {t('payment.backToPaymentInstructions')}
        </Link>
        {isPaymentStatusTerminal && !isPaymentConfirmed && (
          <Link href={buildBookingPageUrl()} className="btn btn-secondary">
            {t('payment.bookAgain')}
          </Link>
        )}
      </div>
    </section>
  );
}
