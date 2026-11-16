'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import { formatCryptoAmount, formatLocalPrice } from '@/lib/eventFormat';

const BARCODE_LINE_WIDTHS = [2, 1, 3, 1, 2, 4, 1, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 3, 1, 2];

function AdmissionSealMark() {
  return (
    <svg
      className="admission-pass__seal"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="30" />
      <circle cx="32" cy="32" r="23" strokeDasharray="1 3" />
      <path d="M32 9v6M32 49v6M9 32h6M49 32h6M15.7 15.7l4.2 4.2M44.1 44.1l4.2 4.2M48.3 15.7l-4.2 4.2M19.9 44.1l-4.2 4.2" />
      <rect x="28.5" y="28.5" width="7" height="7" transform="rotate(45 32 32)" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AdmissionBarcodeMark() {
  return (
    <span className="admission-pass__barcode" aria-hidden="true">
      {BARCODE_LINE_WIDTHS.map((lineWidth, lineIndex) => (
        <span
          key={`${lineWidth}-${lineIndex}`}
          className="admission-pass__barcode-line"
          style={{ width: `${lineWidth}px` }}
        />
      ))}
    </span>
  );
}

export default function AdmissionPassCard() {
  const { t } = useLanguage();
  const {
    name,
    dateLabel,
    location,
    currency,
    ticketPrice,
    regularTicketPrice,
    cryptoAmount,
    cryptoCurrency,
    cryptoNetwork,
    seatCapacity,
  } = useEvent().eventConfig;

  const hasRegularPrice = regularTicketPrice && regularTicketPrice > ticketPrice;

  return (
    <article className="admission-pass" aria-label={t('site.hero.passLabel')}>
      <div className="admission-pass__stub">
        <span className="admission-pass__stub-rule" aria-hidden="true" />
        <span className="admission-pass__stub-text">{t('site.hero.passStub')}</span>
        <span className="admission-pass__stub-number">001</span>
      </div>

      <div className="admission-pass__body">
        <div className="admission-pass__head">
          <span>DienAcademy</span>
          <span>{t('site.hero.passSerial')} 001 / {seatCapacity}</span>
        </div>

        <h2 className="admission-pass__title">{name}</h2>

        <dl className="admission-pass__facts">
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
              {hasRegularPrice && (
                <s className="admission-pass__regular">
                  {currency} {formatLocalPrice(regularTicketPrice)}
                </s>
              )}
            </dd>
          </div>
          <div>
            <dt>{cryptoCurrency}</dt>
            <dd>
              {formatCryptoAmount(cryptoAmount)} {cryptoCurrency} · {cryptoNetwork}
            </dd>
          </div>
        </dl>

        <div className="admission-pass__foot">
          <AdmissionSealMark />
          <div className="admission-pass__foot-meta">
            <span>{t('site.hero.format')}</span>
            <span>{t('site.hero.sessionFormat')}</span>
          </div>
          <AdmissionBarcodeMark />
        </div>
      </div>
    </article>
  );
}
