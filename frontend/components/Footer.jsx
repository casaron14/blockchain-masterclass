'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import NewsletterSignup from '@/components/NewsletterSignup';
import { buildEventHomeUrl } from '@/lib/siteRoutes';

export default function Footer() {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const {
    name,
    dateLabel,
    supportEmail,
    supportPhone,
    addressLine1,
    addressLine2,
    platformName,
  } = eventConfig;
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="site-footer__top">
          <div className="site-footer__identity">
            <Link href={buildEventHomeUrl()} className="site-footer__wordmark">
              {name}
            </Link>
            <p className="site-footer__meta">
              {dateLabel} · {addressLine1}
            </p>
            <p className="site-footer__organiser">{t('site.footer.organiser')}</p>
          </div>

          <div className="site-footer__column">
            <h2 className="site-footer__heading">{t('site.footer.heading')}</h2>
            <NewsletterSignup />
          </div>

          <div className="site-footer__column">
            <h2 className="site-footer__heading">{t('site.footer.contact')}</h2>
            <address className="site-footer__address">
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
              <a href={`tel:${supportPhone}`}>{supportPhone}</a>
              <span>{addressLine1}</span>
              <span>{addressLine2}</span>
            </address>
            <nav className="site-footer__legal" aria-label="Legal">
              <a href="https://www.dienacademy.com/privacy-policy">
                {t('site.footer.legal.privacy')}
              </a>
              <a href="#">{t('site.footer.legal.terms')}</a>
            </nav>
          </div>
        </div>

        <div className="site-footer__bottom">
          <p>{t('site.footer.rights', { year: currentYear, name })}</p>
          <p>{t('site.footer.colophon')}</p>
          <p>
            {t('site.footer.powered')}{' '}
            <a href="https://www.dienacademy.com" target="_blank" rel="noopener noreferrer">
              {platformName}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
