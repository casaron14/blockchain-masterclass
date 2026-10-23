'use client';

import { useEffect, useState } from 'react';

import HairlineLoadingIndicator from '@/components/HairlineLoadingIndicator';
import LoadingButton from '@/components/LoadingButton';
import {
  adminDownloadOfflinePaymentReceipt,
  fetchAdminOfflinePaymentReceiptFile,
} from '@/lib/api';
import { resolveOfflinePaymentReceiptPreviewKind } from '@/lib/offlinePaymentReceiptPreview';

// Shows the receipt the attendee uploaded, so an admin can review it without
// downloading anything. The file is fetched with the admin token and exposed
// through a short-lived object URL.
export default function OfflinePaymentReceiptPreview({
  bookingId,
  adminToken,
  fileName,
  children,
}) {
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState(null);
  const [receiptPreviewKind, setReceiptPreviewKind] = useState('unsupported');
  const [isLoadingReceiptPreview, setIsLoadingReceiptPreview] = useState(true);
  const [receiptPreviewError, setReceiptPreviewError] = useState(null);
  const [isDownloadingReceipt, setIsDownloadingReceipt] = useState(false);
  const [receiptDownloadError, setReceiptDownloadError] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    let createdPreviewUrl = null;

    setIsLoadingReceiptPreview(true);
    setReceiptPreviewError(null);
    setReceiptPreviewUrl(null);
    setReceiptPreviewKind('unsupported');

    fetchAdminOfflinePaymentReceiptFile(bookingId, adminToken)
      .then(({ receiptBlob, receiptMimeType }) => {
        if (isCancelled) {
          return;
        }
        createdPreviewUrl = window.URL.createObjectURL(receiptBlob);
        setReceiptPreviewUrl(createdPreviewUrl);
        setReceiptPreviewKind(resolveOfflinePaymentReceiptPreviewKind(receiptMimeType));
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setReceiptPreviewUrl(null);
        setReceiptPreviewKind('unsupported');
        setReceiptPreviewError(
          error.message || 'The uploaded receipt could not be opened.'
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingReceiptPreview(false);
        }
      });

    return () => {
      isCancelled = true;
      if (createdPreviewUrl) {
        window.URL.revokeObjectURL(createdPreviewUrl);
      }
    };
  }, [bookingId, adminToken]);

  const receiptAltText = `Uploaded Lipa Namba receipt ${fileName || bookingId}`;

  function handleOpenOfflinePaymentReceiptInNewTab() {
    if (!receiptPreviewUrl) {
      return;
    }
    window.open(receiptPreviewUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleDownloadOfflinePaymentReceipt() {
    setReceiptDownloadError(null);
    setIsDownloadingReceipt(true);
    try {
      await adminDownloadOfflinePaymentReceipt(bookingId, adminToken);
    } catch (error) {
      setReceiptDownloadError(error.message || 'Receipt could not be downloaded.');
    } finally {
      setIsDownloadingReceipt(false);
    }
  }

  return (
    <figure className="receipt-preview">
      {isLoadingReceiptPreview && (
        <p className="receipt-preview__status">
          <HairlineLoadingIndicator size={14} />
          Loading the uploaded receipt…
        </p>
      )}

      {!isLoadingReceiptPreview && receiptPreviewError && (
        <p className="error-banner">{receiptPreviewError}</p>
      )}

      {!isLoadingReceiptPreview && !receiptPreviewError && receiptPreviewUrl && (
        receiptPreviewKind === 'image' ? (
          <a
            className="receipt-preview__link"
            href={receiptPreviewUrl}
            target="_blank"
            rel="noreferrer"
          >
            <img
              className="receipt-preview__image"
              src={receiptPreviewUrl}
              alt={receiptAltText}
            />
            <span className="receipt-preview__hint">Open full size</span>
          </a>
        ) : receiptPreviewKind === 'pdf' ? (
          <iframe
            className="receipt-preview__frame"
            src={receiptPreviewUrl}
            title={receiptAltText}
          />
        ) : (
          <p className="muted">
            This receipt format cannot be previewed. Download it to review it.
          </p>
        )
      )}

      {receiptDownloadError && <p className="error-banner">{receiptDownloadError}</p>}

      <div className="admin-actions">
        <LoadingButton
          type="button"
          className="btn btn-secondary"
          spinnerColor="#f2ede3"
          autoLoading={false}
          disabled={!receiptPreviewUrl}
          onClick={handleOpenOfflinePaymentReceiptInNewTab}
        >
          Open receipt
        </LoadingButton>

        <LoadingButton
          type="button"
          className="btn btn-secondary"
          spinnerColor="#f2ede3"
          autoLoading={false}
          loading={isDownloadingReceipt}
          loadingLabel="Downloading receipt…"
          onClick={handleDownloadOfflinePaymentReceipt}
        >
          Download receipt
        </LoadingButton>

        {children}
      </div>
    </figure>
  );
}
