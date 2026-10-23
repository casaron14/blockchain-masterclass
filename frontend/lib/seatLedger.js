export const SEAT_LEDGER_CELL_STATES = Object.freeze({
  CONFIRMED: 'confirmed',
  HELD: 'held',
  OPEN: 'open',
});

function normalizeSeatCount(rawSeatCount) {
  const parsedSeatCount = Number(rawSeatCount);
  if (!Number.isFinite(parsedSeatCount) || parsedSeatCount <= 0) {
    return 0;
  }
  return Math.floor(parsedSeatCount);
}

/**
 * Turns a live availability snapshot into one entry per seat so the admission
 * ledger can draw confirmed, held and open states truthfully.
 */
export function buildSeatLedgerSegments({
  seatCapacity,
  confirmedCount = 0,
  activeSeatHolds = 0,
}) {
  const normalizedCapacity = normalizeSeatCount(seatCapacity);
  const normalizedConfirmedCount = Math.min(
    normalizeSeatCount(confirmedCount),
    normalizedCapacity
  );
  const normalizedHeldCount = Math.min(
    normalizeSeatCount(activeSeatHolds),
    normalizedCapacity - normalizedConfirmedCount
  );

  return Array.from({ length: normalizedCapacity }, (_, seatIndex) => {
    if (seatIndex < normalizedConfirmedCount) {
      return {
        position: seatIndex + 1,
        state: SEAT_LEDGER_CELL_STATES.CONFIRMED,
      };
    }
    if (seatIndex < normalizedConfirmedCount + normalizedHeldCount) {
      return {
        position: seatIndex + 1,
        state: SEAT_LEDGER_CELL_STATES.HELD,
      };
    }
    return {
      position: seatIndex + 1,
      state: SEAT_LEDGER_CELL_STATES.OPEN,
    };
  });
}

export function countOpenSeatsInLedger(seatLedgerSegments) {
  return seatLedgerSegments.filter(
    (seatSegment) => seatSegment.state === SEAT_LEDGER_CELL_STATES.OPEN
  ).length;
}
