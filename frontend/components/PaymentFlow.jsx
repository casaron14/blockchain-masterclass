'use client';

import { useEffect, useRef, useState } from 'react';
import {
  fetchPaymentOverviewById,
  fetchBookingRecordById,
  initiateUsdtPayment,
  uploadLipaNambaPaymentReceipt,
} from '@/lib/api';
import { fetchStoredBookingRecord } from '@/lib/bookingStorage';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import { SUPPORTED_PAYMENT_METHODS } from '@/lib/eventConfig';
import { formatLocalPrice } from '@/lib/eventFormat';
import { formatPaymentHoldCountdown } from '@/lib/paymentHoldCountdown';
import LoadingButton from '@/components/LoadingButton';
import HairlineLoadingIndicator from '@/components/HairlineLoadingIndicator';
import PaymentLoadingSkeleton from '@/components/PaymentLoadingSkeleton';

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

function readStoredBookingRecord(eventSlug) {
  if (typeof window !== 'undefined') {
    return fetchStoredBookingRecord(eventSlug);
  }
  return null;
}

function CopyAddressIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function AddressCopiedIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function PaymentFlow({ paymentId }) {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const {
    slug,
    currency,
    ticketPrice,
    cryptoAmount,
    cryptoCurrency,
    cryptoNetwork,
    lipaNambaNumber,
    lipaNambaAccountName,
  } = eventConfig;

  const [paymentRecord, setPaymentRecord] = useState(null);
  const [bookingExpiresAtMs, setBookingExpiresAtMs] = useState(null);
  const [remainingMilliseconds, setRemainingMilliseconds] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [usdtInstructions, setUsdtInstructions] = useState(null);
  const [depositQrDataUrl, setDepositQrDataUrl] = useState(null);
  const [isAddressCopied, setIsAddressCopied] = useState(false);

  const [offlinePaymentReceipt, setOfflinePaymentReceipt] = useState(null);
  const [bookingReferenceCode, setBookingReferenceCode] = useState('');
  const [attendeeFullName, setAttendeeFullName] = useState('');
  const [isOfflineSeatHoldActive, setIsOfflineSeatHoldActive] = useState(null);
  const [selectedReceiptFile, setSelectedReceiptFile] = useState(null);
  const [receiptUploadError, setReceiptUploadError] = useState(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const receiptFileInputRef = useRef(null);

  const [statusMessage, setStatusMessage] = useState(null);
  const [statusTone, setStatusTone] = useState('info');

  const paymentLabelParams = {
    currency,
    price: formatLocalPrice(ticketPrice),
    crypto: cryptoCurrency,
    network: cryptoNetwork,
    amount: cryptoAmount,
  };

  useEffect(() => {
    const storedBookingRecord = readStoredBookingRecord(slug);
    if (storedBookingRecord?.ref) {
      setBookingReferenceCode(storedBookingRecord.ref);
    }
    if (storedBookingRecord?.full_name) {
      setAttendeeFullName(storedBookingRecord.full_name);
    }
  }, [slug]);

  useEffect(() => {
    fetchPaymentOverviewById(paymentId)
      .then(async (paymentOverview) => {
        const payment = paymentOverview.payment;
        setPaymentRecord(payment);
        setOfflinePaymentReceipt(paymentOverview.offlineReceipt ?? null);

        let bookingRecord = null;
        if (payment.booking_id) {
          bookingRecord = await fetchBookingRecordById(payment.booking_id).catch(() => null);
        }
        if (!bookingRecord) {
          bookingRecord = readStoredBookingRecord(slug);
        }
        if (bookingRecord?.ref) {
          setBookingReferenceCode(bookingRecord.ref);
        }
        if (bookingRecord?.full_name) {
          setAttendeeFullName(bookingRecord.full_name);
        }
        if (!bookingRecord?.expires_at) {
          return;
        }
        const bookingExpiresAt = Date.parse(bookingRecord.expires_at);
        if (!Number.isNaN(bookingExpiresAt)) {
          setBookingExpiresAtMs(bookingExpiresAt);
        }
      })
      .catch((error) => {
        setLoadError(error.message || t('payment.genericError'));
      });
  }, [paymentId, t, slug]);

  // A confirmed payment does not need a hold countdown; the ticket is already
  // being delivered, so the timer must not overwrite the confirmation notice
  // with an "expired" message.
  const paymentStatusValue = paymentRecord?.status;

  useEffect(() => {
    if (!bookingExpiresAtMs || paymentStatusValue === 'confirmed') {
      return undefined;
    }

    function updateRemainingTime() {
      const remainingMs = bookingExpiresAtMs - Date.now();
      setRemainingMilliseconds(remainingMs);
      if (remainingMs <= 0) {
        setStatusTone('error');
        setStatusMessage(t('payment.statusExpired'));
      }
    }

    updateRemainingTime();
    const countdownTimer = setInterval(updateRemainingTime, 1000);

    return () => clearInterval(countdownTimer);
  }, [bookingExpiresAtMs, paymentStatusValue, t]);

  useEffect(() => {
    if (!paymentRecord || paymentRecord.payment_method !== SUPPORTED_PAYMENT_METHODS.usdt_bep20) {
      return undefined;
    }
    if (usdtInstructions) {
      return undefined;
    }

    let isCancelled = false;

    initiateUsdtPayment(paymentId)
      .then(async (instructions) => {
        if (isCancelled) {
          return;
        }
        setUsdtInstructions(instructions);

        // Loaded only when a USDT payment is actually shown, so the QR encoder
        // stays out of the initial bundle for landing-page visits.
        const { default: QRCode } = await import('qrcode');
        const qrDataUrl = await QRCode.toDataURL(instructions.receivingWallet, {
          margin: 1,
          width: 260,
          color: { dark: '#46352a', light: '#f6f0e4' },
        });
        if (!isCancelled) {
          setDepositQrDataUrl(qrDataUrl);
        }
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        if (error.status === 409) {
          setStatusTone('error');
          setStatusMessage(t('payment.expired'));
        } else {
          setStatusTone('error');
          setStatusMessage(t('payment.genericError'));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [paymentRecord, paymentId, t, usdtInstructions]);

  const isPaymentStatusTerminal = ['confirmed', 'failed', 'expired'].includes(
    paymentRecord?.status
  );
  const isOfflinePaymentAwaitingReview =
    paymentRecord?.payment_method === SUPPORTED_PAYMENT_METHODS.lipanamba &&
    offlinePaymentReceipt?.status === 'submitted' &&
    !isPaymentStatusTerminal;

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

    if (
      receiptFile.type &&
      !SUPPORTED_RECEIPT_MIME_TYPES.includes(receiptFile.type)
    ) {
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
    setStatusMessage(null);
    setIsUploadingReceipt(true);

    try {
      const uploadResult = await uploadLipaNambaPaymentReceipt(
        paymentId,
        selectedReceiptFile,
        bookingReferenceCode
      );
      setOfflinePaymentReceipt(uploadResult.offlineReceipt);
      setIsOfflineSeatHoldActive(uploadResult.isSeatHoldActive !== false);
      if (uploadResult.bookingExpiresAt) {
        const refreshedBookingExpiresAt = Date.parse(uploadResult.bookingExpiresAt);
        if (!Number.isNaN(refreshedBookingExpiresAt)) {
          setBookingExpiresAtMs(refreshedBookingExpiresAt);
        }
      }
      setPaymentRecord((currentPaymentRecord) =>
        currentPaymentRecord
          ? { ...currentPaymentRecord, status: 'pending', confirmed_at: null }
          : currentPaymentRecord
      );
      setSelectedReceiptFile(null);
      if (receiptFileInputRef.current) {
        receiptFileInputRef.current.value = '';
      }
    } catch (error) {
      setReceiptUploadError(error.message || t('payment.genericError'));
    } finally {
      setIsUploadingReceipt(false);
    }
  }

  async function handleCopyDepositAddress() {
    const depositAddressToCopy = usdtInstructions?.receivingWallet;
    if (!depositAddressToCopy) {
      return;
    }
    try {
      await navigator.clipboard.writeText(depositAddressToCopy);
      setIsAddressCopied(true);
      setTimeout(() => setIsAddressCopied(false), 2000);
    } catch {
      setStatusTone('error');
      setStatusMessage(t('payment.genericError'));
    }
  }

  const isCountdownUrgent =
    bookingExpiresAtMs !== null &&
    remainingMilliseconds !== null &&
    remainingMilliseconds <= 120000;
  const canUploadOfflinePaymentReceipt =
    paymentRecord?.status !== 'confirmed' &&
    offlinePaymentReceipt?.status !== 'approved' &&
    (offlinePaymentReceipt?.status !== 'submitted' || isPaymentStatusTerminal);

  if (loadError) {
    return <p className="error-banner">{loadError}</p>;
  }

  if (!paymentRecord) {
    return <PaymentLoadingSkeleton statusLabel={t('loadingStates.loadingPayment')} />;
  }

  const paymentMethod = paymentRecord.payment_method;

  return (
    <section className="card">
      {bookingExpiresAtMs !== null && paymentStatusValue !== 'confirmed' && (
        <div className={`hold-countdown ${isCountdownUrgent ? 'warning' : ''}`}>
          <span>{t('payment.timeRemaining')}</span>
          <strong>
            {remainingMilliseconds !== null
              ? formatPaymentHoldCountdown(remainingMilliseconds)
              : formatPaymentHoldCountdown(bookingExpiresAtMs - Date.now())}
          </strong>
        </div>
      )}

      <h2 className="card__title">{t('payment.title')}</h2>

      {paymentStatusValue === 'confirmed' && (
        <p className="status-message success" role="status">
          {t('payment.confirmedNotice')}
        </p>
      )}

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

      {paymentMethod === SUPPORTED_PAYMENT_METHODS.usdt_bep20 &&
        paymentStatusValue !== 'confirmed' && (
        <div className="payment-flow">
          <p>{t('payment.usdtInstructions', paymentLabelParams)}</p>

          <div className="deposit-panel">
            <div className="qr-code-frame">
              <p className="qr-network-label">
                {t('payment.networkLabel', { network: cryptoNetwork })}
              </p>
              {depositQrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={depositQrDataUrl} alt={t('payment.depositQrAlt')} className="qr-code" />
              ) : (
                <div className="qr-code-loading" role="status" aria-live="polite">
                  <HairlineLoadingIndicator color="#a34a25" size={18} />
                  <span className="qr-code-loading__label">{t('loadingStates.loadingQr')}</span>
                </div>
              )}
            </div>
            <div className="detail-list">
              <p>
                <strong>{t('payment.usdtWallet', { network: cryptoNetwork })}</strong>
              </p>
              <div className="wallet-address-row">
                <code
                  className={`wallet-address ${
                    usdtInstructions?.receivingWallet ? '' : 'wallet-address--loading'
                  }`}
                  aria-busy={!usdtInstructions?.receivingWallet || undefined}
                >
                  {usdtInstructions?.receivingWallet ? (
                    usdtInstructions.receivingWallet
                  ) : (
                    <>
                      <span className="visually-hidden">{t('loadingStates.loadingWallet')}</span>
                      <span className="skeleton-line skeleton-line--inline" aria-hidden="true" />
                    </>
                  )}
                </code>
                <button
                  type="button"
                  className={`copy-address-icon-button${isAddressCopied ? ' copied' : ''}`}
                  disabled={!usdtInstructions?.receivingWallet}
                  aria-label={
                    isAddressCopied ? t('payment.addressCopied') : t('payment.copyAddress')
                  }
                  title={t('payment.copyAddress')}
                  onClick={handleCopyDepositAddress}
                >
                  {isAddressCopied ? <AddressCopiedIcon /> : <CopyAddressIcon />}
                </button>
              </div>
              <p>
                <strong>{t('payment.usdtAmount')}:</strong> {cryptoAmount} {cryptoCurrency}
              </p>
            </div>
          </div>

          {usdtInstructions && <p className="status-message info">{t('payment.automaticCheck')}</p>}
        </div>
      )}

      {paymentMethod === SUPPORTED_PAYMENT_METHODS.lipanamba &&
        paymentStatusValue !== 'confirmed' && (
        <div className="payment-flow">
          <p>
            {t('payment.lipanambaInstructions', {
              ...paymentLabelParams,
              lipaNambaNumber,
              lipaNambaAccountName,
            })}
          </p>

          <div className="detail-list">
            <p>
              <strong>{t('payment.lipanambaNumberLabel')}:</strong> {lipaNambaNumber}
            </p>
            <p>
              <strong>{t('payment.lipanambaAccountLabel')}:</strong> {lipaNambaAccountName}
            </p>
            <p>
              <strong>{t('payment.lipanambaAmountLabel')}:</strong>{' '}
              {formatLocalPrice(ticketPrice)} {currency}
            </p>
          </div>

          {isOfflinePaymentAwaitingReview && (
            <p className="status-message info">
              {t('payment.lipanambaReceiptAwaitingReview')}
            </p>
          )}

          {offlinePaymentReceipt?.status === 'rejected' && (
            <p className="status-message error">
              {t('payment.lipanambaReceiptRejected')}
            </p>
          )}

          {isOfflinePaymentAwaitingReview &&
            isOfflineSeatHoldActive === false && (
              <p className="status-message error">
                {t('payment.lipanambaSeatHoldUnavailable')}
              </p>
            )}

          {canUploadOfflinePaymentReceipt && (
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

              {selectedReceiptFile && (
                <p className="muted">{selectedReceiptFile.name}</p>
              )}

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
          )}
        </div>
      )}

      {statusMessage && (
        <p className={`status-message ${statusTone}`} role="status">
          {statusMessage}
        </p>
      )}
    </section>
  );
}