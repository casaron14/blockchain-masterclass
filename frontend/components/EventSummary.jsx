'use client';

import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import { formatCryptoAmount, formatLocalPrice } from '@/lib/eventFormat';

export default function EventSummary() {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
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
  } = eventConfig;

  const hasDiscount = regularTicketPrice && regularTicketPrice > ticketPrice;

  return (
    <section className="order-summary" aria-labelledby="orderSummaryTitle">
      <p className="order-summary__label">{t('booking.summaryHeading')}</p>
      <h2 className="order-summary__title" id="orderSummaryTitle">
        {name}
      </h2>

      <dl className="order-summary__facts">
        <div>
          <dt>{t('site.hero.factDate')}</dt>
          <dd>{dateLabel}</dd>
        </div>
        <div>
          <dt>{t('site.hero.factVenue')}</dt>
          <dd>{location}</dd>
        </div>
      </dl>

      <div className="order-summary__price">
        {hasDiscount && (
          <s className="order-summary__regular-price">
            {currency} {formatLocalPrice(regularTicketPrice)}
          </s>
        )}
        <strong>
          {currency} {formatLocalPrice(ticketPrice)}
        </strong>
        <span>
          {t('event.priceCrypto', {
            amount: formatCryptoAmount(cryptoAmount),
            crypto: cryptoCurrency,
            network: cryptoNetwork,
          })}
        </span>
      </div>
    </section>
  );
}
