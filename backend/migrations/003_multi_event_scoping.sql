-- Multi-event scoping.
--
-- The first event ("blockchain-masterclass") has already happened. Its records
-- must remain exactly as they were sold, while the same database now serves
-- later events. This migration therefore:
--
--   1. creates the first event row from the values used for that event;
--   2. attaches every existing booking and referrer to that event;
--   3. gives every booking an immutable event snapshot;
--   4. moves the seat counter from one global row to one row per event;
--   5. keeps a compatibility view named seat_capacity for older tooling.
--
-- Nothing is deleted. The old seat_capacity table only held derived state and
-- is replaced by event_seat_capacity after its values are copied.

-- ---------------------------------------------------------------------
-- 1. First event, preserved as an archived historical event.
-- ---------------------------------------------------------------------

INSERT INTO events (slug, name, status, starts_at, ends_at, configuration)
VALUES (
  'blockchain-masterclass',
  'Blockchain Masterclass',
  'archived',
  TIMESTAMPTZ '2026-11-07 00:00:00+03',
  TIMESTAMPTZ '2026-11-08 00:00:00+03',
  $event_configuration$
  {
    "slug": "blockchain-masterclass",
    "name": "Blockchain Masterclass",
    "tagline": "Book your seat for the Blockchain Masterclass event.",
    "event": {
      "date": "7th November 2026",
      "ticketDateLabel": "07/11/2026",
      "location": "Arusha, Tanzania",
      "venueName": "Village Hall Mafao House",
      "motto": "Jenga mustakabali kwa Blockchain",
      "brandName": "Inkryptus",
      "websiteAddress": "inkryptus.com"
    },
    "durationDays": 1,
    "price": {
      "localCurrency": "TZS",
      "localAmount": 10000,
      "regularLocalAmount": 30000,
      "cryptoCurrency": "USDT",
      "cryptoNetwork": "BEP20",
      "cryptoAmount": 3.8,
      "regularCryptoAmount": 11.27
    },
    "seatCapacity": 150,
    "seatHoldMinutes": 60,
    "phonePlaceholder": "0XXXXXXXXX",
    "contact": {
      "brandName": "DienAcademy",
      "websiteAddress": "dienacademy.com",
      "supportEmail": "support@dienacademy.com",
      "supportPhone": "+255 621 745 217",
      "addressLine1": "Dar es Salaam, Tanzania",
      "addressLine2": "P.O. Box 689",
      "platformName": "DienAcademy.com"
    },
    "payment": {
      "lipaNambaNumber": "15611485",
      "lipaNambaAccountName": "DienAcademy",
      "offlineReviewHoldMinutes": 1440
    },
    "paymentMethods": ["lipanamba"],
    "comingSoonPaymentMethods": ["azampesa", "usdt_bep20"]
  }
  $event_configuration$::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Preserve any admin edits that were saved in the old override table before
-- the event registry existed. Nested objects are merged individually so an
-- override of event.date does not erase event.venueName.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM event_config_overrides WHERE slug = 'blockchain-masterclass'
  ) THEN
    UPDATE events AS event_record
       SET configuration =
             (event_record.configuration
               || (override_record.overrides - 'event' - 'price' - 'contact' - 'payment'))
             || jsonb_build_object(
                  'event',
                  COALESCE(event_record.configuration -> 'event', '{}'::jsonb)
                    || COALESCE(override_record.overrides -> 'event', '{}'::jsonb),
                  'price',
                  COALESCE(event_record.configuration -> 'price', '{}'::jsonb)
                    || COALESCE(override_record.overrides -> 'price', '{}'::jsonb),
                  'contact',
                  COALESCE(event_record.configuration -> 'contact', '{}'::jsonb)
                    || COALESCE(override_record.overrides -> 'contact', '{}'::jsonb),
                  'payment',
                  COALESCE(event_record.configuration -> 'payment', '{}'::jsonb)
                    || COALESCE(override_record.overrides -> 'payment', '{}'::jsonb)
                ),
           name = COALESCE(override_record.overrides ->> 'name', event_record.name)
      FROM event_config_overrides AS override_record
     WHERE event_record.slug = override_record.slug;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Attach every existing booking and referrer to the first event.
-- ---------------------------------------------------------------------

UPDATE bookings
   SET event_id = (
         SELECT id FROM events WHERE slug = 'blockchain-masterclass'
       )
 WHERE event_id IS NULL;

UPDATE bookings
   SET event_snapshot = (
         SELECT configuration FROM events WHERE events.id = bookings.event_id
       )
 WHERE event_snapshot = '{}'::jsonb;

UPDATE referrers
   SET event_id = (
         SELECT id FROM events WHERE slug = 'blockchain-masterclass'
       )
 WHERE event_id IS NULL;

ALTER TABLE bookings ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE referrers ALTER COLUMN event_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_event_id_fkey'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES events (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referrers_event_id_fkey'
  ) THEN
    ALTER TABLE referrers
      ADD CONSTRAINT referrers_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES events (id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Move the seat counter from one global row to one row per event.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  first_event_id BIGINT;
  legacy_cap INTEGER;
  legacy_confirmed_count INTEGER;
BEGIN
  SELECT id INTO first_event_id
    FROM events WHERE slug = 'blockchain-masterclass';

  IF to_regclass('seat_capacity') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_class WHERE relname = 'seat_capacity' AND relkind = 'r'
     ) THEN
    EXECUTE 'SELECT cap, confirmed_count FROM seat_capacity WHERE id = 1'
      INTO legacy_cap, legacy_confirmed_count;
  END IF;

  INSERT INTO event_seat_capacity (event_id, confirmed_count, cap)
  VALUES (
    first_event_id,
    COALESCE(legacy_confirmed_count, 0),
    COALESCE(
      legacy_cap,
      COALESCE(
        (SELECT (configuration ->> 'seatCapacity')::INTEGER FROM events WHERE id = first_event_id),
        150
      )
    )
  )
  ON CONFLICT (event_id) DO NOTHING;
END $$;

-- Give every event a capacity row. New events normally get one when they are
-- created; this also covers a database that was seeded manually.
INSERT INTO event_seat_capacity (event_id, confirmed_count, cap)
SELECT event_record.id,
       0,
       COALESCE((event_record.configuration ->> 'seatCapacity')::INTEGER, 150)
  FROM events AS event_record
ON CONFLICT (event_id) DO NOTHING;

-- The bookings table is the truth for confirmed seats.
UPDATE event_seat_capacity
   SET confirmed_count = actual_counts.confirmed_count
  FROM (
    SELECT event_id, COUNT(*)::INTEGER AS confirmed_count
      FROM bookings
     WHERE status = 'confirmed' AND event_id IS NOT NULL
     GROUP BY event_id
  ) AS actual_counts
 WHERE event_seat_capacity.event_id = actual_counts.event_id
   AND event_seat_capacity.confirmed_count IS DISTINCT FROM actual_counts.confirmed_count;

-- Replace the old single-row table with a compatibility view. The view is
-- intentionally backed by the first event so older admin scripts keep working;
-- application code uses event_seat_capacity directly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'seat_capacity' AND relkind = 'r'
  ) THEN
    DROP TABLE seat_capacity CASCADE;
  ELSIF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'seat_capacity' AND relkind = 'v'
  ) THEN
    DROP VIEW seat_capacity;
  END IF;
END $$;

CREATE VIEW seat_capacity AS
SELECT event_id AS id, confirmed_count, cap
  FROM event_seat_capacity
 WHERE event_id = (
       SELECT id FROM events WHERE slug = 'blockchain-masterclass'
     );

-- ---------------------------------------------------------------------
-- 4. Indexes that make per-event reads cheap.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings (event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_event_active_holds
  ON bookings (event_id, expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bookings_event_status_created
  ON bookings (event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrers_event_id ON referrers (event_id);
CREATE INDEX IF NOT EXISTS idx_event_seat_capacity_cap
  ON event_seat_capacity (event_id, cap);
