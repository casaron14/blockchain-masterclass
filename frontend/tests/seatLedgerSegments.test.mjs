import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSeatLedgerSegments,
  countOpenSeatsInLedger,
  SEAT_LEDGER_CELL_STATES,
} from '../lib/seatLedger.js';

test('buildSeatLedgerSegments marks confirmed seats first, then held seats, then open seats', () => {
  const seatLedgerSegments = buildSeatLedgerSegments({
    seatCapacity: 150,
    confirmedCount: 3,
    activeSeatHolds: 2,
  });

  assert.equal(seatLedgerSegments.length, 150);
  assert.deepEqual(
    seatLedgerSegments.slice(0, 5).map((seatSegment) => seatSegment.state),
    [
      SEAT_LEDGER_CELL_STATES.CONFIRMED,
      SEAT_LEDGER_CELL_STATES.CONFIRMED,
      SEAT_LEDGER_CELL_STATES.CONFIRMED,
      SEAT_LEDGER_CELL_STATES.HELD,
      SEAT_LEDGER_CELL_STATES.HELD,
    ]
  );
  assert.equal(seatLedgerSegments[5].state, SEAT_LEDGER_CELL_STATES.OPEN);
  assert.equal(seatLedgerSegments[149].position, 150);
});

test('buildSeatLedgerSegments never draws more seats than the capacity', () => {
  const seatLedgerSegments = buildSeatLedgerSegments({
    seatCapacity: 10,
    confirmedCount: 9,
    activeSeatHolds: 4,
  });

  assert.equal(seatLedgerSegments.length, 10);
  assert.equal(
    seatLedgerSegments.filter((seatSegment) => seatSegment.state === SEAT_LEDGER_CELL_STATES.OPEN)
      .length,
    0
  );
  assert.equal(
    seatLedgerSegments.filter((seatSegment) => seatSegment.state === SEAT_LEDGER_CELL_STATES.HELD)
      .length,
    1
  );
});

test('buildSeatLedgerSegments reports a full ledger when every seat is confirmed', () => {
  const seatLedgerSegments = buildSeatLedgerSegments({
    seatCapacity: 150,
    confirmedCount: 150,
    activeSeatHolds: 0,
  });

  assert.equal(countOpenSeatsInLedger(seatLedgerSegments), 0);
  assert.ok(
    seatLedgerSegments.every(
      (seatSegment) => seatSegment.state === SEAT_LEDGER_CELL_STATES.CONFIRMED
    )
  );
});

test('buildSeatLedgerSegments ignores invalid and negative values instead of drawing phantom seats', () => {
  const seatLedgerSegments = buildSeatLedgerSegments({
    seatCapacity: 5,
    confirmedCount: -3,
    activeSeatHolds: 'not-a-number',
  });

  assert.equal(seatLedgerSegments.length, 5);
  assert.equal(countOpenSeatsInLedger(seatLedgerSegments), 5);
  assert.deepEqual(buildSeatLedgerSegments({ seatCapacity: 0 }), []);
});
