'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import lipaNambaPaymentQr from '@/assets/Lipanamba.webp';
import { initiateUsdtPayment } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import { SUPPORTED_PAYMENT_METHODS } from '@/lib/eventConfig';
import { formatLocalPrice } from '@/lib/eventFormat';
import { usePaymentOverviewPolling } from '@/lib/usePaymentOverviewPolling';
import { buildPaymentConfirmationPageUrlForPaymentId } from '@/lib/siteRoutes';
import LoadingButton from '@/components/LoadingButton';
import PaymentHoldCountdown from '@/components/PaymentHoldCountdown';
import HairlineLoadingIndicator from '@/components/HairlineLoadingIndicator';
import PaymentLoadingSkeleton from '@/components/PaymentLoadingSkeleton';

const TERMINAL_PAYMENT_STATUSES = ['confirmed', 'failed', 'expired'];

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

export default function PaymentInstructionsFlow({ paymentId }) {
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
  const router = useRouter();

  const { paymentOverview, bookingRecord, loadError } = usePaymentOverviewPolling({
    paymentId,
    eventSlug: slug,
  });
  const paymentRecord = paymentOverview?.payment ?? null;

  const [usdtInstructions, setUsdtInstructions] = useState(null);
  const [depositQrDataUrl, setDepositQrDataUrl] = useState(null);
  const [isAddressCopied, setIsAddressCopied] = useState(false);
  const [isLipaNambaNumberCopied, setIsLipaNambaNumberCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusTone, setStatusTone] = useState('info');
  const hasRequestedUsdtInstructionsRef = useRef(false);

  const paymentLabelParams = {
    currency,
    price: formatLocalPrice(ticketPrice),
    crypto: cryptoCurrency,
    network: cryptoNetwork,
    amount: cryptoAmount,
  };

  const attendeeFullName = bookingRecord?.full_name ?? '';
  const bookingReferenceCode = bookingRecord?.ref ?? '';
  const parsedBookingExpiresAtMs = bookingRecord?.expires_at
    ? Date.parse(bookingRecord.expires_at)
    : null;
  const bookingExpiresAtMs = Number.isNaN(parsedBookingExpiresAtMs)
    ? null
    : parsedBookingExpiresAtMs;

  // A confirmed payment does not need a hold countdown; the ticket is already
  // being delivered, so the timer must not overwrite the confirmation notice
  // with an "expired" message.
  const paymentStatusValue = paymentRecord?.status;

  useEffect(() => {
    if (!paymentRecord || paymentRecord.payment_method !== SUPPORTED_PAYMENT_METHODS.usdt_bep20) {
      return undefined;
    }
    // The status poll replaces the payment record every few seconds; the
    // deposit request must still be sent only once per visit.
    if (hasRequestedUsdtInstructionsRef.current) {
      return undefined;
    }
    hasRequestedUsdtInstructionsRef.current = true;

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

  async function copyLipaNambaNumberToClipboard() {
    if (!lipaNambaNumber) {
      return;
    }
    try {
      await navigator.clipboard.writeText(lipaNambaNumber);
      setIsLipaNambaNumberCopied(true);
      setTimeout(() => setIsLipaNambaNumberCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy Lipa Namba number to clipboard', error);
      setStatusTone('error');
      setStatusMessage(t('payment.lipaNambaCopyFailed'));
    }
  }

  function handleContinueToPaymentConfirmation() {
    router.push(buildPaymentConfirmationPageUrlForPaymentId(paymentId));
  }

  const isPaymentStatusTerminal = TERMINAL_PAYMENT_STATUSES.includes(paymentStatusValue);

  if (loadError) {
    return <p className="error-banner">{loadError}</p>;
  }

  if (!paymentRecord) {
    return <PaymentLoadingSkeleton statusLabel={t('loadingStates.loadingPayment')} />;
  }

  const paymentMethod = paymentRecord.payment_method;
  const canContinueToPaymentConfirmation =
    !isPaymentStatusTerminal &&
    (paymentMethod === SUPPORTED_PAYMENT_METHODS.lipanamba ||
      paymentMethod === SUPPORTED_PAYMENT_METHODS.usdt_bep20);

  return (
    <section className="card">
      <PaymentHoldCountdown
        bookingExpiresAtMilliseconds={bookingExpiresAtMs}
        isPaymentConfirmed={paymentStatusValue === 'confirmed'}
      />

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
            <div>
              <strong>{t('payment.lipanambaNumberLabel')}:</strong>
              <div className="wallet-address-row">
                <code className="wallet-address">{lipaNambaNumber}</code>
                <button
                  type="button"
                  className={`copy-address-icon-button${isLipaNambaNumberCopied ? ' copied' : ''}`}
                  disabled={!lipaNambaNumber}
                  aria-label={
                    isLipaNambaNumberCopied
                      ? t('payment.lipaNambaNumberCopied')
                      : t('payment.copyLipaNambaNumber')
                  }
                  title={
                    isLipaNambaNumberCopied
                      ? t('payment.lipaNambaNumberCopied')
                      : t('payment.copyLipaNambaNumber')
                  }
                  onClick={copyLipaNambaNumberToClipboard}
                >
                  {isLipaNambaNumberCopied ? <AddressCopiedIcon /> : <CopyAddressIcon />}
                </button>
              </div>
            </div>
            <p>
              <strong>{t('payment.lipanambaAccountLabel')}:</strong> {lipaNambaAccountName}
            </p>
            <p>
              <strong>{t('payment.lipanambaAmountLabel')}:</strong>{' '}
              {formatLocalPrice(ticketPrice)} {currency}
            </p>
          </div>

          <div className="lipanamba-qr">
            <p>{t('payment.lipaNambaScanPrompt')}</p>
            <Image
              src={lipaNambaPaymentQr}
              alt={t('payment.lipaNambaQrAlt')}
              className="lipanamba-qr__image"
              sizes="(max-width: 48rem) 100vw, 20rem"
              priority
            />
          </div>
        </div>
      )}

      {statusMessage && (
        <p className={`status-message ${statusTone}`} role="status">
          {statusMessage}
        </p>
      )}

      {canContinueToPaymentConfirmation && (
        <div className="payment-next-step">
          <LoadingButton
            type="button"
            className="btn btn-primary"
            spinnerColor="#f2ede3"
            autoLoading={false}
            onClick={handleContinueToPaymentConfirmation}
          >
            {t('payment.confirmPaymentButton')}
          </LoadingButton>
        </div>
      )}
    </section>
  );
}
