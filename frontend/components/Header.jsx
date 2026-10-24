'use client';

import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import {
  buildBookingPageUrl,
  buildEventHomeSectionUrlForSectionId,
  buildEventHomeUrl,
} from '@/lib/siteRoutes';

const EVENT_SECTION_LINKS = [
  { sectionId: 'programme', labelKey: 'site.nav.programme' },
  { sectionId: 'admission', labelKey: 'site.nav.admission' },
  { sectionId: 'questions', labelKey: 'site.nav.questions' },
];

export default function Header() {
  const { t } = useLanguage();
  const { eventConfig, isLoadingEvent } = useEvent();
  const { name, dateLabel } = eventConfig;

  return (
    <header className="site-header" aria-busy={isLoadingEvent || undefined}>
      <div className="site-header__inner shell">
        <Link href={buildEventHomeUrl()} className="site-wordmark">
          <span className="site-wordmark__institution">DienAcademy</span>
          <span className="site-wordmark__event">{name}</span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          {EVENT_SECTION_LINKS.map(({ sectionId, labelKey }) => (
            <Link key={sectionId} href={buildEventHomeSectionUrlForSectionId(sectionId)} className="site-nav__link">
              {t(labelKey)}
            </Link>
          ))}
        </nav>

        <div className="site-header__actions">
          <span className="site-header__dateline">{dateLabel}</span>
          <LanguageSwitcher />
          <Link href={buildBookingPageUrl()} className="button button--paper site-header__cta">
            {t('app.bookNow')}
          </Link>
        </div>
      </div>

      {isLoadingEvent && (
        <div className="site-header__loading" role="status" aria-live="polite">
          <span className="visually-hidden">{t('loadingStates.loadingEvent')}</span>
          <span className="loading-rule loading-rule--on-ink" aria-hidden="true">
            <span className="loading-rule__bar" />
          </span>
        </div>
      )}
    </header>
  );
}
