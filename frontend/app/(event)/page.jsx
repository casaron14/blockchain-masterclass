'use client';

import Link from 'next/link';
import Image from 'next/image';
import AdmissionPassCard from '@/components/AdmissionPassCard';
import SeatAvailabilityBanner from '@/components/SeatAvailabilityBanner';
import inkryptusHorizontalLogo from '@/assets/inkryptus-horizontal.svg';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import { getTranslation } from '@/lib/translations';
import { formatCryptoAmount, formatLocalPrice } from '@/lib/eventFormat';
import { buildBookingPageUrl } from '@/lib/siteRoutes';

export default function MasterHomePage() {
  const { language, t } = useLanguage();
  const { eventConfig } = useEvent();
  const {
    name,
    location,
    dateLabel,
    currency,
    ticketPrice,
    regularTicketPrice,
    cryptoAmount,
    cryptoCurrency,
    cryptoNetwork,
    seatCapacity,
    seatHoldMinutes,
    supportEmail,
    supportPhone,
  } = eventConfig;

  const statItems = getTranslation(language, 'site.stats.items');
  const highlightItems = getTranslation(language, 'site.highlights.items');
  const agendaItems = getTranslation(language, 'site.agenda.items');
  const faqItems = getTranslation(language, 'site.faq.items');
  const inclusionItems = getTranslation(language, 'site.admission.includes');

  const hasDiscount = regularTicketPrice && regularTicketPrice > ticketPrice;

  return (
    <div className="institution-page">
      <section className="hero-plate">
        <div className="shell hero-plate__grid">
          <div className="hero-plate__copy">
            <p className="hero-plate__dateline">
              {dateLabel} · {location}
            </p>

            <h1 className="hero-plate__title">
              <span className="hero-plate__title-line">
                {t('site.hero.titleLead')}
              </span>
              <span className="hero-plate__title-line">
                <em>{t('site.hero.titleConnector')}</em>{' '}
                <span className="hero-plate__title-accent">
                  {t('site.hero.titleTwo')}
                </span>
              </span>
            </h1>

            <p className="hero-plate__lede">{t('site.hero.subtitle', { name })}</p>

            <div className="hero-plate__actions">
              <Link href={buildBookingPageUrl()} className="button button--paper">
                {t('site.hero.cta')}
              </Link>
              <a href="#programme" className="text-link">
                {t('site.hero.viewProgramme')}
              </a>
            </div>

            <dl className="hero-plate__facts">
              <div>
                <dt>{t('site.hero.factDate')}</dt>
                <dd>{dateLabel}</dd>
              </div>
              <div>
                <dt>{t('site.hero.factVenue')}</dt>
                <dd>{location}</dd>
              </div>
              <div>
                <dt>{t('site.hero.factAdmission')}</dt>
                <dd>
                  {currency} {formatLocalPrice(ticketPrice)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="hero-plate__specimen">
            <AdmissionPassCard />
          </div>
        </div>
      </section>

      <section className="ledger-band">
        <SeatAvailabilityBanner tone="paper" fullBleed />
      </section>

      <section className="section programme-section" id="programme">
        <div className="shell programme-layout">
          <div className="programme-aside">
            <h2 className="display-heading">{t('site.agenda.title')}</h2>
            <p className="lede">{t('site.agenda.intro')}</p>
          </div>

          <ol className="programme-list">
            {Array.isArray(agendaItems) &&
              agendaItems.map((agendaItem, agendaIndex) => (
                <li className="programme-row" key={agendaItem.title}>
                  <span className="programme-row__index" aria-hidden="true">
                    {String(agendaIndex + 1).padStart(2, '0')}
                  </span>
                  <div className="programme-row__body">
                    <h3 className="programme-row__title">{agendaItem.title}</h3>
                    <p className="programme-row__description">{agendaItem.description}</p>
                  </div>
                </li>
              ))}
          </ol>
        </div>
      </section>

      <section className="record-band" aria-labelledby="recordBandHeading">
        <div className="shell record-band__inner">
          <div className="record-band__heading-group">
            <h2 className="record-band__heading" id="recordBandHeading">
              {t('site.record.heading')}
            </h2>
            <p className="record-band__note">{t('site.record.note')}</p>
          </div>

          <dl className="record-strip">
            {Array.isArray(statItems) &&
              statItems.map((statItem) => (
                <div className="record-strip__item" key={statItem.label}>
                  <dd className="record-strip__figure">{statItem.value}</dd>
                  <dt className="record-strip__label">{statItem.label}</dt>
                </div>
              ))}
          </dl>
        </div>
      </section>

      <section className="section section--tint" id="method">
        <div className="shell method-layout">
          <div className="method-statement">
            <h2 className="display-heading">{t('site.highlights.title')}</h2>
            <p className="lede">{t('site.highlights.intro', { name })}</p>
          </div>

          <div className="method-index">
            {Array.isArray(highlightItems) &&
              highlightItems.map((highlightItem) => (
                <article className="method-entry" key={highlightItem.title}>
                  <h3 className="method-entry__title">{highlightItem.title}</h3>
                  <p className="method-entry__description">{highlightItem.description}</p>
                </article>
              ))}
          </div>
        </div>
      </section>

      <section className="section section--ink admission-section" id="admission">
        <div className="shell admission-layout">
          <div className="admission-copy">
            <h2 className="display-heading display-heading--on-ink">
              {t('site.admission.heading')}
            </h2>

            <div className="admission-price">
              {hasDiscount && (
                <s className="admission-price__regular">
                  {t('site.admission.regular')} · {currency}{' '}
                  {formatLocalPrice(regularTicketPrice)}
                </s>
              )}
              <strong className="admission-price__amount">
                {currency} {formatLocalPrice(ticketPrice)}
              </strong>
              <span className="admission-price__crypto">
                {formatCryptoAmount(cryptoAmount)} {cryptoCurrency} · {cryptoNetwork}
              </span>
            </div>

            <h3 className="admission-includes__heading">
              {t('site.admission.includesHeading')}
            </h3>
            <ul className="admission-includes">
              {Array.isArray(inclusionItems) &&
                inclusionItems.map((inclusionItem) => (
                  <li key={inclusionItem}>{inclusionItem}</li>
                ))}
            </ul>

            <Link href={buildBookingPageUrl()} className="button button--paper">
              {t('site.hero.cta')}
            </Link>
            <p className="admission-note">
              {t('site.admission.reserveNote', { holdMinutes: seatHoldMinutes })}
            </p>
          </div>

          <div className="admission-ledger">
            <SeatAvailabilityBanner tone="ink" />
            <p className="admission-ledger__meta">
              {dateLabel} · {location} · {seatCapacity} {t('site.hero.seats')}
            </p>
          </div>
        </div>
      </section>

      <section className="partner-band">
        <div className="shell partner-band__inner">
          <p className="partner-band__label">{t('site.partner.label')}</p>
          <a
            className="partner-band__mark"
            href="https://inkryptus.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Inkryptus"
          >
            <Image
              className="partner-band__logo"
              src={inkryptusHorizontalLogo}
              alt="Inkryptus"
              width={240}
              height={80}
            />
          </a>
          <a
            className="partner-band__link"
            href="https://inkryptus.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            inkryptus.com
          </a>
        </div>
      </section>

      <section className="section questions-section" id="questions">
        <div className="shell questions-layout">
          <div className="questions-aside">
            <h2 className="display-heading">{t('site.faq.title')}</h2>

            <div className="questions-support">
              <h3>{t('site.questions.supportHeading')}</h3>
              <p>{t('site.questions.supportNote')}</p>
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
              <a href={`tel:${supportPhone}`}>{supportPhone}</a>
            </div>
          </div>

          <div className="faq-list">
            {Array.isArray(faqItems) &&
              faqItems.map((faqItem, faqIndex) => (
                <details
                  className="faq-item"
                  key={faqItem.question}
                  open={faqIndex === 0}
                >
                  <summary className="faq-item__question">
                    <span>{faqItem.question}</span>
                    <svg
                      className="faq-item__icon"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      aria-hidden="true"
                    >
                      <path d="M1 8h14" />
                      <path className="faq-item__icon-vertical" d="M8 1v14" />
                    </svg>
                  </summary>
                  <div className="faq-item__answer">{faqItem.answer}</div>
                </details>
              ))}
          </div>
        </div>
      </section>

      <section className="closing-plate">
        <div className="shell closing-plate__inner">
          <div className="closing-plate__copy">
            <h2 className="closing-plate__title">{t('site.closing.heading')}</h2>
            <p className="closing-plate__body">{t('site.closing.body')}</p>
          </div>

          <div className="closing-plate__action">
            <Link href={buildBookingPageUrl()} className="button button--paper">
              {t('site.hero.cta')}
            </Link>
            <p className="closing-plate__meta">{t('site.closing.meta')}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
