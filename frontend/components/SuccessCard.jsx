'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import {
  fetchBookingRecordByReferenceCode,
  triggerTicketPdfDownload,
} from '@/lib/api';
import LoadingButton from '@/components/LoadingButton';
import LoadingStatusLine from '@/components/LoadingStatusLine';
import { buildBookingPageUrl, buildEventHomeUrl } from '@/lib/siteRoutes';

export default function SuccessCard({ referenceCode }) {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const { supportEmail } = eventConfig;
  const [bookingRecord, setBookingRecord] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isAutoPreparingTicket, setIsAutoPreparingTicket] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const autoDownloadTriggeredRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    fetchBookingRecordByReferenceCode(referenceCode)
      .then((record) => {
        if (isMounted) setBookingRecord(record);
      })
      .catch((error) => {
        if (isMounted) setLoadError(error.message);
      });

    return () => {
      isMounted = false;
    };
  }, [referenceCode]);

  useEffect(() => {
    if (!bookingRecord || bookingRecord.status !== 'confirmed') {
      return;
    }
    if (autoDownloadTriggeredRef.current) {
      return;
    }
    autoDownloadTriggeredRef.current = true;
    setIsAutoPreparingTicket(true);

    triggerTicketPdfDownload(referenceCode)
      .catch((error) => {
        setDownloadError(error.message || t('success.downloadFailed'));
      })
      .finally(() => {
        setIsAutoPreparingTicket(false);
      });
  }, [bookingRecord, referenceCode, t]);

  const handleManualTicketDownload = useCallback(async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await triggerTicketPdfDownload(referenceCode);
    } catch (error) {
      setDownloadError(error.message || t('success.downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  }, [referenceCode, t]);

  return (
    <section className="toast-card success-toast" role="status" aria-live="polite">
      <div className="toast-check-stamp" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 16.5 13.5 22 24 10" />
        </svg>
      </div>

      <h2 className="toast-title">{t('success.title')}</h2>
      <p className="toast-message muted">{t('success.message')}</p>

      <dl className="toast-detail-list">
        <div>
          <dt>
            <span className="toast-detail-label">{t('success.reference')}</span>
            <code>{referenceCode}</code>
          </dt>
        </div>
        {!loadError && (
          <div>
            <dt>
              <span className="toast-detail-label">{t('success.attendee')}</span>
              {bookingRecord?.full_name ? (
                <span>{bookingRecord.full_name}</span>
              ) : (
                <>
                  <span className="visually-hidden">
                    {t('loadingStates.loadingAttendee')}
                  </span>
                  <span className="skeleton-line skeleton-line--inline" aria-hidden="true" />
                </>
              )}
            </dt>
          </div>
        )}
      </dl>

      {loadError && <p className="field-error">{loadError}</p>}

      {!loadError && (
        <p className="toast-ticket-note muted">{t('success.ticketNote')}</p>
      )}

      {isAutoPreparingTicket && (
        <LoadingStatusLine
          label={t('success.downloading')}
          compact
          className="toast-auto-download"
        />
      )}

      <LoadingButton
        type="button"
        className="btn btn-primary toast-download-btn"
        autoLoading={false}
        loading={isDownloading}
        loadingLabel={t('success.downloading')}
        onClick={handleManualTicketDownload}
      >
        {t('success.downloadTicket')}
      </LoadingButton>
      {downloadError && <p className="field-error">{downloadError}</p>}

      <div className="toast-footer-row">
        <div className="toast-footer-links">
          <Link href={buildBookingPageUrl()} className="toast-link">
            {t('success.findBooking')}
          </Link>
          <Link href={buildEventHomeUrl()} className="toast-link">
            {t('success.backHome')}
          </Link>
        </div>
        <span className="toast-support">
          {t('success.supportText')}{' '}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </span>
      </div>
    </section>
  );
}