'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import { buildNotFoundDestinationLinks } from '@/lib/notFoundLinks';

export default function NotFoundRecord() {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const requestedAddress = usePathname() || '/';
  const destinationLinks = buildNotFoundDestinationLinks();

  return (
    <div className="not-found-page">
      <section className="not-found-plate">
        <div className="shell not-found-plate__grid">
          <div className="not-found-plate__record">
            <p className="not-found-plate__eyebrow">
              {t('notFound.eyebrow')} · {t('notFound.codeLabel')}
            </p>

            <p className="not-found-plate__code" aria-hidden="true">
              404
            </p>

            <h1 className="not-found-plate__title">{t('notFound.heading')}</h1>
            <p className="not-found-plate__body">{t('notFound.body')}</p>

            <div className="not-found-plate__actions">
              <Link href={destinationLinks.eventHome} className="button button--paper">
                {t('notFound.primary')}
              </Link>
              <Link href={destinationLinks.bookingLookup} className="text-link">
                {t('notFound.secondary')}
              </Link>
            </div>

            <p className="not-found-plate__support">
              {t('notFound.supportNote')}{' '}
              <a href={`mailto:${eventConfig.supportEmail}`}>{eventConfig.supportEmail}</a>
              <span className="not-found-plate__admin-link-group">
                <span aria-hidden="true">{' · '}</span>
                <Link href={destinationLinks.backOffice} className="not-found-plate__admin-link">
                  {t('notFound.tertiary')}
                </Link>
              </span>
            </p>
          </div>

          <aside className="not-found-docket" aria-label={t('notFound.docketLabel')}>
            <div className="not-found-docket__head">
              <span>{t('notFound.docketLabel')}</span>
              <span>{t('notFound.docketSerial')}</span>
            </div>

            <dl className="not-found-docket__facts">
              <div>
                <dt>{t('notFound.requestedAddress')}</dt>
                <dd>
                  <code>{requestedAddress}</code>
                </dd>
              </div>
              <div>
                <dt>{t('notFound.statusLabel')}</dt>
                <dd>
                  <span className="status-chip failed">{t('notFound.statusValue')}</span>
                </dd>
              </div>
              <div>
                <dt>{t('notFound.eventLabel')}</dt>
                <dd>{eventConfig.name}</dd>
              </div>
              <div>
                <dt>{t('notFound.dateLabel')}</dt>
                <dd>{eventConfig.dateLabel}</dd>
              </div>
            </dl>

            <div className="not-found-docket__foot">
              <span className="not-found-docket__seal">{t('notFound.sealText')}</span>
              <span className="not-found-docket__barcode" aria-hidden="true" />
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
