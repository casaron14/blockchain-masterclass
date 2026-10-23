import { buildSeatLedgerSegments } from '@/lib/seatLedger';

export default function SeatLedgerGrid({
  seatCapacity,
  confirmedCount = 0,
  activeSeatHolds = 0,
  accessibleDescription,
}) {
  const seatLedgerSegments = buildSeatLedgerSegments({
    seatCapacity,
    confirmedCount,
    activeSeatHolds,
  });

  return (
    <div
      className="seat-ledger__grid"
      role="img"
      aria-label={accessibleDescription}
    >
      {seatLedgerSegments.map((seatSegment) => (
        <span
          key={seatSegment.position}
          className={`seat-ledger__cell seat-ledger__cell--${seatSegment.state}`}
          style={{ '--seat-order': seatSegment.position }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
