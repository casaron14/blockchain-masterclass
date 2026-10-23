'use client';

import { useEffect, useState } from 'react';
import { fetchEventAvailability } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';
import { useEvent } from '@/context/EventContext';
import SeatLedgerGrid from '@/components/SeatLedgerGrid';

export default function SeatAvailabilityBanner({ tone = 'paper', compact = false, fullBleed = false }) {
  const { t } = useLanguage();
  const { eventConfig } = useEvent();
  const { slug, seatCapacity } = eventConfig;
  const [availability, setAvailability] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    fetchEventAvailability(slug)
      .then((payload) => {
        if (isMounted) setAvailability(payload);
      })
      .catch((error) => {
        if (isMounted) setLoadError(error.message);
      });

    return () => {
      isMounted = false;
    };
  }, [slug]);

  const ledgerClassName = [
    'seat-ledger',
    `seat-ledger--${tone}`,
    compact ? 'seat-ledger--compact' : '',
    fullBleed ? 'seat-ledger--full-bleed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (loadError) {
    return (
      <section className={ledgerClassName} aria-label={t('site.ledger.label')}>
        <p className="seat-ledger__note">{t('site.ledger.unavailable')}</p>
      </section>
    );
  }

  if (!availability) {
    return (
      <section
        className={`${ledgerClassName} seat-ledger--loading`}
        aria-label={t('site.ledger.label')}
        aria-busy="true"
      >
        <p className="seat-ledger__note">{t('site.ledger.reading')}</p>
        <div className="seat-ledger__grid" aria-hidden="true">
          {Array.from({ length: seatCapacity }, (_, seatIndex) => (
            <span key={seatIndex} className="seat-ledger__cell seat-ledger__cell--loading" />
          ))}
        </div>
      </section>
    );
  }

  const confirmedCount = availability.confirmedCount || 0;
  const activeSeatHolds = availability.activeSeatHolds || 0;
  const openSeatCount = Math.max(0, availability.seatsRemaining ?? seatCapacity - confirmedCount);

  const ledgerDescription = t('seats.filled', {
    filled: confirmedCount,
    capacity: seatCapacity,
  });

  return (
    <section
      className={ledgerClassName}
      aria-label={t('site.ledger.label')}
    >
      <div className="seat-ledger__head">
        <div className="seat-ledger__readout">
          <span className="seat-ledger__caption">
            {availability.isSoldOut ? t('seats.soldOut') : t('site.ledger.remaining')}
          </span>
          <strong className="seat-ledger__number">
            {availability.isSoldOut ? '0' : openSeatCount}
          </strong>
        </div>

        <div className="seat-ledger__states">
          <span className="seat-ledger__state">
            <i className="seat-ledger__key seat-ledger__key--confirmed" aria-hidden="true" />
            {t('site.ledger.confirmed', { count: confirmedCount })}
          </span>
          <span className="seat-ledger__state">
            <i className="seat-ledger__key seat-ledger__key--held" aria-hidden="true" />
            {t('site.ledger.held', { count: activeSeatHolds })}
          </span>
          <span className="seat-ledger__state">
            <i className="seat-ledger__key seat-ledger__key--open" aria-hidden="true" />
            {t('site.ledger.open', { count: openSeatCount })}
          </span>
        </div>
      </div>

      <SeatLedgerGrid
        seatCapacity={seatCapacity}
        confirmedCount={confirmedCount}
        activeSeatHolds={activeSeatHolds}
        accessibleDescription={ledgerDescription}
      />

      <p className="seat-ledger__note">
        {t('seats.filled', { filled: confirmedCount, capacity: seatCapacity })}
        {activeSeatHolds > 0 ? ` ${t('seats.held', { held: activeSeatHolds })}` : ''}
      </p>
    </section>
  );
}
