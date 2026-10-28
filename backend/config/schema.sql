-- =====================================================================
-- Event Booking / Payment Schema
-- Target: PostgreSQL 13+
-- =====================================================================
-- Canonical business values for this event live in shared/eventConfig.js.
-- PostgreSQL cannot import JS, so the SQL below re-declares the same
-- constants (seat cap 150, 60-minute hold, payment methods). Keep these
-- in sync whenever shared/eventConfig.js changes.
--
-- Entities:
--   1. bookings               - attendee + booking lifecycle
--   2. payments               - payment lifecycle, 1:1 with a booking
--   3. seat_capacity          - single-row counter enforcing the event seat cap
--   4. payment_webhooks       - audited inbound AzamPesa callbacks
--   5. payment_webhook_errors - failed or rejected inbound callbacks
--   6. blockchain_transactions - verified USDT/BEP20 transfers
--   7. blockchain_transaction_errors - failed/suspect crypto verifications
--   8. blockchain_transaction_webhooks - audited crypto provider callbacks
--   9. azampesa               - confirmed AzamPesa STK transactions
--  10. ticket_deliveries      - outgoing ticket email delivery state
--  11. users                  - optional future admin tooling (not public flow)
--
-- Concurrency note (seat cap enforcement):
--   This schema enforces the "confirmed_count <= cap" invariant with a
--   CHECK constraint plus a trigger that keeps the counter in sync with
--   booking status changes. That prevents the counter itself from ever
--   being wrong or over-cap. But to prevent TWO simultaneous requests
--   both succeeding when only one seat is left, the application must
--   still do the increment inside a transaction that first locks the
--   counter row, e.g.:
--
--     BEGIN;
--       SELECT confirmed_count, cap FROM seat_capacity
--         WHERE id = 1 FOR UPDATE;         -- blocks concurrent readers
--       -- application checks confirmed_count < cap here
--       UPDATE bookings SET status = 'confirmed' WHERE id = :booking_id;
--       -- trigger below increments seat_capacity.confirmed_count
--     COMMIT;
--
--   The FOR UPDATE lock is what actually serializes concurrent
--   confirmations; the CHECK constraint is a backstop, not a substitute.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Enum types (aligned to shared/eventConfig.js paymentMethods)
-- ---------------------------------------------------------------------

-- PostgreSQL has no CREATE TYPE IF NOT EXISTS. The DO/EXCEPTION guard makes
-- re-running this script safe: a second run skips the existing type instead of
-- aborting the whole transaction and leaving the schema half-migrated.
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('azampesa', 'usdt_bep20', 'lipanamba');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Existing deployments already have the payment_method type, so the guard above
-- skips the new value. ALTER TYPE is the only way to add an enum value without
-- dropping the column that uses it.
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'lipanamba';

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('initiating', 'pending', 'confirmed', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE delivery_status AS ENUM ('pending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- Helper: generic updated_at trigger function
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bookings (
  id              BIGSERIAL PRIMARY KEY,
  ref             TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  phone_number    TEXT NOT NULL,
  email           TEXT NOT NULL,
  status          booking_status NOT NULL DEFAULT 'pending',

  -- set only after the first ticket email has been accepted by the mail server.
  -- A NULL value means no ticket has been delivered yet, so a confirmation
  -- retry or a repeated webhook may still attempt delivery. Admin resends do
  -- not change this value; ticket_deliveries.sent_at tracks the latest send.
  ticket_sent_at  TIMESTAMPTZ,

  -- which invite link / marketing channel this attendee arrived through
  -- (e.g. "neema" for a personal invite, or a campaign source). NULL means
  -- the attendee did not arrive through a tracked link.
  utm_source      TEXT,

  -- an unpaid/unconfirmed booking is marked expired after the hold window
  -- (shared/eventConfig.js seatHoldMinutes, 60 by default), freeing its
  -- (never-confirmed) seat hold for someone else
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '60 minutes'),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bookings_email_format_chk CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- add the columns to an existing deployment without dropping data
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_ticket_sent_at
  ON bookings (ticket_sent_at)
  WHERE ticket_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_phone  ON bookings (phone_number);
CREATE INDEX IF NOT EXISTS idx_bookings_email  ON bookings (email);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_utm_source ON bookings (utm_source);

-- Availability reads and the hold-expiry job both filter on the live pending
-- holds only. A partial index keeps that count cheap as the bookings table
-- grows past the event.
CREATE INDEX IF NOT EXISTS idx_bookings_active_holds
  ON bookings (expires_at)
  WHERE status = 'pending';

CREATE OR REPLACE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- referrers - self-service invite identities (invite link creators)
--   Each row is one person who registered to invite others to the event.
--   referrer_code is the referrer's username, shared as siteurl/?ref=<username>
--   and stored on bookings.utm_source for attribution.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS referrers (
  id               BIGSERIAL PRIMARY KEY,

  referrer_code    TEXT NOT NULL UNIQUE,
  referrer_name    TEXT NOT NULL,
  referrer_phone   TEXT NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT referrers_code_format_chk CHECK (
    referrer_code ~ '^[a-z0-9_-]{2,100}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_referrers_code ON referrers (referrer_code);

-- ---------------------------------------------------------------------
-- payments  (1:1 with bookings via unique booking_id)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payments (
  id               BIGSERIAL PRIMARY KEY,

  booking_id       BIGINT NOT NULL UNIQUE
                     REFERENCES bookings (id) ON DELETE CASCADE,

  payment_method   payment_method NOT NULL,
  amount_expected  NUMERIC(14, 2) NOT NULL CHECK (amount_expected > 0),
  status           payment_status NOT NULL DEFAULT 'pending',

  reference_id     TEXT,          -- STK transaction ref, once available

  -- crypto-only fields (USDT BEP20)
  wallet_address   TEXT,
  tx_hash          TEXT,

  initiated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- crypto fields only make sense for usdt_bep20; keep other methods clean
  CONSTRAINT payments_crypto_fields_chk CHECK (
    (payment_method = 'usdt_bep20')
    OR (wallet_address IS NULL AND tx_hash IS NULL)
  ),

  -- confirmed_at should only be set once the payment is actually confirmed
  CONSTRAINT payments_confirmed_at_chk CHECK (
    (status = 'confirmed' AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_at IS NULL)
  )
);

-- Column repair, and it must run before the indexes and CHECK constraints
-- below that reference payment_method. CREATE TABLE IF NOT EXISTS above
-- skips a table that already exists, so it cannot add this column itself.
--
-- payment_method is absent on databases created before the payment rail was
-- split into azampesa / usdt_bep20. It is added nullable and only then
-- tightened, so the end state matches the canonical NOT NULL definition
-- without a default that would silently mislabel existing rows.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_method payment_method;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'payments' AND column_name = 'payment_method'
       AND is_nullable = 'YES'
  ) THEN
    -- Refuse to guess a payment rail for a row that already has one. Any
    -- such row must be classified by hand, not defaulted.
    IF EXISTS (SELECT 1 FROM payments WHERE payment_method IS NULL) THEN
      RAISE EXCEPTION
        'payments.payment_method is NULL on existing rows; classify them before re-running this script';
    END IF;
    ALTER TABLE payments ALTER COLUMN payment_method SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_tx_hash
  ON payments (tx_hash) WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments (payment_method);

CREATE OR REPLACE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- payment_webhooks - audited inbound AzamPesa callbacks
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_webhooks (
  id               BIGSERIAL PRIMARY KEY,

  payment_id       BIGINT NOT NULL
                     REFERENCES payments (id) ON DELETE CASCADE,

  payload          JSONB NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhooks_payment_id
  ON payment_webhooks (payment_id);

-- ---------------------------------------------------------------------
-- payment_webhook_errors - failed or rejected inbound callbacks
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_webhook_errors (
  id               BIGSERIAL PRIMARY KEY,

  payment_id       BIGINT NOT NULL
                     REFERENCES payments (id) ON DELETE CASCADE,

  payload          JSONB NOT NULL,
  error_message    TEXT NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_errors_payment_id
  ON payment_webhook_errors (payment_id);

-- ---------------------------------------------------------------------
-- blockchain_transactions - verified USDT/BEP20 transfers
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blockchain_transactions(
  id               BIGSERIAL PRIMARY KEY,

  payment_id       BIGINT NOT NULL
                     REFERENCES payments (id) ON DELETE CASCADE,

  tx_hash          TEXT NOT NULL UNIQUE,
  block_number     BIGINT NOT NULL,
  from_address     TEXT NOT NULL,
  to_address       TEXT NOT NULL,
  value            NUMERIC(14, 2) NOT NULL CHECK (value > 0),
  confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blockchain_transactions_tx_hash
  ON blockchain_transactions (tx_hash);

-- ---------------------------------------------------------------------
-- blockchain_transaction_errors - failed/suspect crypto verifications
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blockchain_transaction_errors(
  id               BIGSERIAL PRIMARY KEY,

  payment_id       BIGINT NOT NULL
                     REFERENCES payments (id) ON DELETE CASCADE,

  tx_hash          TEXT NOT NULL,
  error_message    TEXT NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_transaction_errors_payment_id
  ON blockchain_transaction_errors (payment_id);

-- ---------------------------------------------------------------------
-- blockchain_transaction_webhooks - audited crypto provider callbacks
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blockchain_transaction_webhooks(
  id               BIGSERIAL PRIMARY KEY,

  payment_id       BIGINT NOT NULL
                     REFERENCES payments (id) ON DELETE CASCADE,

  payload          JSONB NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- azampesa - confirmed AzamPesa STK transactions
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS azampesa (
  id               BIGSERIAL PRIMARY KEY,

  payment_id       BIGINT NOT NULL
                     REFERENCES payments (id) ON DELETE CASCADE,

  tx_id            TEXT NOT NULL UNIQUE,
  value            NUMERIC(14, 2) NOT NULL CHECK (value > 0),
  confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- ticket_deliveries - outgoing ticket email delivery state (retry support)
--
-- One row per booking. sent_at is updated after every successful send, so it
-- is the last time the ticket reached the attendee. bookings.ticket_sent_at is
-- the first successful send and the guard that keeps automatic confirmations
-- idempotent; admin resends deliberately bypass that guard.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket_deliveries (
  id               BIGSERIAL PRIMARY KEY,

  booking_id       BIGINT NOT NULL UNIQUE
                     REFERENCES bookings (id) ON DELETE CASCADE,

  qr_payload       TEXT,
  status           delivery_status NOT NULL DEFAULT 'pending',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,

  -- short-lived lock so two confirmations for the same booking cannot both
  -- send a ticket. It is cleared on success or failure and expires on its own
  -- if the process dies mid-send.
  send_claimed_at  TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Column repair, and it must run before the index below that references
-- status. CREATE TABLE IF NOT EXISTS above skips a table that already
-- exists, so it cannot add this column itself. Without it the application
-- surfaces a 500 on every ticket delivery.
ALTER TABLE ticket_deliveries
  ADD COLUMN IF NOT EXISTS status delivery_status NOT NULL DEFAULT 'pending';
ALTER TABLE ticket_deliveries
  ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ticket_deliveries_status
  ON ticket_deliveries (status);

CREATE OR REPLACE TRIGGER trg_ticket_deliveries_updated_at
  BEFORE UPDATE ON ticket_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- users - optional future admin tooling (not part of the public flow)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  username         TEXT NOT NULL UNIQUE,
  email            TEXT NOT NULL UNIQUE,
  hashed_password  TEXT NOT NULL,
  is_admin         BOOLEAN NOT NULL DEFAULT false,
  totp_secret      TEXT,
  totp_enabled     BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- make existing deployments upgrade safely without dropping data
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- seat_capacity - single counter row, seeded from the event cap (must match
-- shared/eventConfig.js seatCapacity)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seat_capacity (
  id              SMALLINT PRIMARY KEY DEFAULT 1,
  confirmed_count INTEGER NOT NULL DEFAULT 0,
  cap             INTEGER NOT NULL DEFAULT 150,

  CONSTRAINT seat_capacity_single_row_chk CHECK (id = 1),
  CONSTRAINT seat_capacity_within_cap_chk CHECK (confirmed_count BETWEEN 0 AND cap)
);

-- seed the single counter row. ON CONFLICT keeps re-runs non-destructive:
-- it must never reset confirmed_count on an existing deployment.
INSERT INTO seat_capacity (id, confirmed_count, cap) VALUES (1, 0, 150)
  ON CONFLICT (id) DO NOTHING;

-- keep the counter in sync automatically whenever a booking's status
-- transitions into or out of 'confirmed' (application still must lock
-- this row with FOR UPDATE before deciding to confirm a new booking --
-- see concurrency note at top of file)
CREATE OR REPLACE FUNCTION sync_seat_capacity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      UPDATE seat_capacity SET confirmed_count = confirmed_count + 1 WHERE id = 1;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'confirmed' AND NEW.status = 'confirmed' THEN
      UPDATE seat_capacity SET confirmed_count = confirmed_count + 1 WHERE id = 1;
    ELSIF OLD.status = 'confirmed' AND NEW.status <> 'confirmed' THEN
      UPDATE seat_capacity SET confirmed_count = confirmed_count - 1 WHERE id = 1;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      UPDATE seat_capacity SET confirmed_count = confirmed_count - 1 WHERE id = 1;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_seat_capacity
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION sync_seat_capacity();

-- ---------------------------------------------------------------------
-- USDT BEP20 deposit collection (per-order HD derived addresses)
-- Spec: backend/blockchain.md
--   orders             - one per booking that has an active USDT deposit
--                        address; customer_id doubles as the monotonic,
--                        never-reused BIP44 derivation index
--   deposit_addresses  - the unique address assigned to an order
--   deposits_observed  - every USDT transfer noticed at a deposit address
--   sweeps             - fund-then-sweep lifecycle for moving USDT to treasury
--   treasury_ledger    - running record of USDT moved into the treasury wallet
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('pending', 'paid', 'expired', 'swept');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sweep_status AS ENUM ('pending', 'funded', 'swept', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- monotonic counter for the per-order derivation index, never reused even if
-- the owning order later expires unpaid. IF NOT EXISTS keeps re-runs safe:
-- the sequence must never be restarted, or derivation indexes would repeat
-- and two orders could be handed the same deposit address.
CREATE SEQUENCE IF NOT EXISTS customer_derivation_seq START WITH 1;

CREATE TABLE IF NOT EXISTS orders (
  id               BIGSERIAL PRIMARY KEY,

  customer_id      BIGINT NOT NULL UNIQUE
                     DEFAULT nextval('customer_derivation_seq'),

  booking_id       BIGINT NOT NULL
                     REFERENCES bookings (id) ON DELETE CASCADE,

  ticket_ids       JSONB NOT NULL DEFAULT '[]',
  amount_usdt      NUMERIC(14, 2) NOT NULL CHECK (amount_usdt > 0),

  status           order_status NOT NULL DEFAULT 'pending',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '60 minutes')
);

CREATE INDEX IF NOT EXISTS idx_orders_booking_id ON orders (booking_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- The order-expiry job only ever scans pending orders by expiry.
CREATE INDEX IF NOT EXISTS idx_orders_pending_expiry
  ON orders (expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS deposit_addresses (
  -- One order can hold more than one deposit address over its lifetime: a
  -- hold that expires unpaid gets a fresh address, and the old one must stay
  -- on record so a late payment to it is still attributed and never stranded.
  id                BIGSERIAL PRIMARY KEY,

  order_id          BIGINT NOT NULL
                      REFERENCES orders (id) ON DELETE CASCADE,

  derivation_index  BIGINT NOT NULL UNIQUE,
  address           TEXT NOT NULL UNIQUE,

  -- The address currently handed to the client. Exactly one active address per
  -- order; earlier ones are marked inactive but stay scannable.
  is_active         BOOLEAN NOT NULL DEFAULT true,
  superseded_at     TIMESTAMPTZ,

  -- inclusive "safe" watermark: all transfers up to this block have been
  -- polled at least once, so the next poll can start at last_scanned_block + 1.
  -- 0 = not yet scanned (full history from genesis on first poll).
  last_scanned_block BIGINT NOT NULL DEFAULT 0,

  -- Last time this address was seen carrying a balance or a new transfer.
  -- Drives the "still holding funds" sweep candidate query.
  last_observed_at  TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The original definition keyed this table by order_id, which allowed exactly
-- one address per order. Promote the surrogate id to the primary key so a
-- re-issued address can be added without dropping the earlier one.
ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS id BIGSERIAL;

ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

ALTER TABLE deposit_addresses
  ADD COLUMN IF NOT EXISTS last_observed_at TIMESTAMPTZ;

ALTER TABLE deposit_addresses
  DROP CONSTRAINT IF EXISTS deposit_addresses_pkey;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deposit_addresses_pkey'
  ) THEN
    ALTER TABLE deposit_addresses
      ADD PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deposit_addresses_order_id
  ON deposit_addresses (order_id);

-- At most one address per order may be the active one; historical addresses
-- are exempt so the constraint does not block a re-issue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_addresses_one_active_per_order
  ON deposit_addresses (order_id)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS deposits_observed (
  id               BIGSERIAL PRIMARY KEY,

  address          TEXT NOT NULL,
  tx_hash          TEXT NOT NULL UNIQUE,
  from_address     TEXT,

  amount           NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  block_number     BIGINT NOT NULL,

  -- Exact on-chain value. NUMERIC(14,2) is a rounded human figure, so every
  -- amount comparison that decides "is this payment complete" is done on this
  -- integer instead of the rounded column.
  amount_wei       NUMERIC(78, 0),

  -- The block hash at the time the log was read. A reorg that drops the block
  -- changes the hash for the same height, which is how a deposit that was
  -- rolled back is detected before the payment is confirmed.
  block_hash       TEXT,

  -- BNB Smart Chain has deterministic fast finality, so a deposit is settled
  -- once its block is at or below the finalized head, not after an arbitrary
  -- confirmation count.
  is_finalized     BOOLEAN NOT NULL DEFAULT false,
  finality_confirmed_at TIMESTAMPTZ,
  finalized_block_number BIGINT,

  confirmations    INTEGER NOT NULL DEFAULT 0,

  order_id         BIGINT NOT NULL
                     REFERENCES orders (id) ON DELETE CASCADE,

  matched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE deposits_observed
  ADD COLUMN IF NOT EXISTS amount_wei NUMERIC(78, 0);

ALTER TABLE deposits_observed
  ADD COLUMN IF NOT EXISTS block_hash TEXT;

ALTER TABLE deposits_observed
  ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE deposits_observed
  ADD COLUMN IF NOT EXISTS finality_confirmed_at TIMESTAMPTZ;

ALTER TABLE deposits_observed
  ADD COLUMN IF NOT EXISTS finalized_block_number BIGINT;

CREATE INDEX IF NOT EXISTS idx_deposits_observed_order_id
  ON deposits_observed (order_id);

CREATE INDEX IF NOT EXISTS idx_deposits_observed_tx_hash
  ON deposits_observed (tx_hash);

-- The finality pass reads only deposits that are not finalized yet.
CREATE INDEX IF NOT EXISTS idx_deposits_observed_unfinalized
  ON deposits_observed (block_number DESC)
  WHERE is_finalized = false;

CREATE TABLE IF NOT EXISTS sweeps (
  id               BIGSERIAL PRIMARY KEY,

  address          TEXT NOT NULL,
  order_id         BIGINT NOT NULL
                     REFERENCES orders (id) ON DELETE CASCADE,

  tx_hash          TEXT,
  amount           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gas_used         BIGINT,
  bnb_funded       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  bnb_funded_wei   NUMERIC(78, 0),
  failure_reason   TEXT,

  -- Chain facts about the collection. Together with tx_hash + amount these
  -- rows are the proof that a deposit was paid and then moved to treasury,
  -- which is how an ambiguous payment (funds already swept before the
  -- confirmation ran) is resolved without trusting a live balance.
  amount_wei       NUMERIC(78, 0),
  block_number     BIGINT,
  block_hash       TEXT,
  gas_price_wei    NUMERIC(78, 0),
  is_finalized     BOOLEAN NOT NULL DEFAULT false,
  treasury_address TEXT,
  triggered_by     TEXT NOT NULL DEFAULT 'scheduled',
  confirmed_at     TIMESTAMPTZ,

  status           sweep_status NOT NULL DEFAULT 'pending',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS amount_wei NUMERIC(78, 0);

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS block_number BIGINT;

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS block_hash TEXT;

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS gas_price_wei NUMERIC(78, 0);

-- BNB is far finer than the NUMERIC(14,2) display column can hold: a typical
-- sweep fee is ~0.0005 BNB, which rounds to 0.00 there. The sponsorship budget
-- is summed from this exact wei value instead.
ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS bnb_funded_wei NUMERIC(78, 0);

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS treasury_address TEXT;

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS triggered_by TEXT NOT NULL DEFAULT 'scheduled';

ALTER TABLE sweeps
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sweeps_order_id ON sweeps (order_id);
CREATE INDEX IF NOT EXISTS idx_sweeps_status ON sweeps (status);

CREATE OR REPLACE TRIGGER trg_sweeps_updated_at
  BEFORE UPDATE ON sweeps
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS treasury_ledger (
  id               BIGSERIAL PRIMARY KEY,

  order_id         BIGINT NOT NULL
                     REFERENCES orders (id) ON DELETE CASCADE,

  sweep_id         BIGINT NOT NULL
                     REFERENCES sweeps (id) ON DELETE CASCADE,

  tx_hash          TEXT NOT NULL UNIQUE,
  amount           NUMERIC(14, 2) NOT NULL CHECK (amount > 0),

  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_ledger_order_id
  ON treasury_ledger (order_id);

-- ---------------------------------------------------------------------
-- usdt_transfer_scan_state - single-row cursor for the transfer listener
--   The listener reads the token contract once per tick and then attributes
--   every matching transfer to a deposit address in SQL, so the cursor is
--   global (one row) rather than per order. Without it a restart would
--   either rescan the whole chain or skip the blocks while the process was
--   down.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS usdt_transfer_scan_state (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  last_scanned_block    BIGINT NOT NULL DEFAULT 0,
  last_finalized_block  BIGINT NOT NULL DEFAULT 0,
  last_scanned_at       TIMESTAMPTZ,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,

  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO usdt_transfer_scan_state (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- payment_receipts - the receipt an attendee gets, and its delivery state
--   The row is written inside the same transaction that confirms the payment,
--   so a receipt can never exist for a payment that is not confirmed, and a
--   confirmed payment always has a receipt row to attach the PDF to.
-- ---------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_status') THEN
    CREATE TYPE receipt_status AS ENUM ('pending', 'issued', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_receipts (
  id                    BIGSERIAL PRIMARY KEY,

  payment_id            BIGINT NOT NULL UNIQUE
                          REFERENCES payments (id) ON DELETE CASCADE,
  booking_id            BIGINT NOT NULL
                          REFERENCES bookings (id) ON DELETE CASCADE,
  order_id              BIGINT REFERENCES orders (id) ON DELETE SET NULL,

  deposit_address       TEXT NOT NULL,
  payer_address         TEXT,

  tx_hash               TEXT NOT NULL,
  block_number          BIGINT NOT NULL,
  block_hash            TEXT,

  amount_paid           NUMERIC(14, 2) NOT NULL,
  amount_wei            NUMERIC(78, 0) NOT NULL,

  -- Snapshot of the settlement state at the moment the receipt was issued, so
  -- an issued receipt is self-describing even if the chain is re-scanned later.
  finalized_block_number BIGINT NOT NULL,
  confirmations_at_issue INTEGER NOT NULL DEFAULT 0,

  explorer_tx_url       TEXT,
  pdf_path              TEXT,
  pdf_sha256            TEXT,

  status                receipt_status NOT NULL DEFAULT 'pending',
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  issued_at             TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_status
  ON payment_receipts (status);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_booking_id
  ON payment_receipts (booking_id);

CREATE OR REPLACE TRIGGER trg_payment_receipts_updated_at
  BEFORE UPDATE ON payment_receipts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- offline_payment_receipts - proof uploaded by a Lipa Namba payer
--   Unlike payment_receipts (which the platform generates for a settled
--   USDT payment), this row is the document the attendee uploaded. The
--   admin opens it, checks it against the Lipa Namba statement, and then
--   confirms the payment. One current receipt is kept per payment; a
--   re-upload replaces the previous file so the reviewer never has to
--   choose between two versions.
-- ---------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offline_receipt_status') THEN
    CREATE TYPE offline_receipt_status AS ENUM ('submitted', 'approved', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS offline_payment_receipts (
  id                  BIGSERIAL PRIMARY KEY,

  payment_id          BIGINT NOT NULL UNIQUE
                        REFERENCES payments (id) ON DELETE CASCADE,
  booking_id          BIGINT NOT NULL
                        REFERENCES bookings (id) ON DELETE CASCADE,

  original_file_name  TEXT NOT NULL,
  stored_file_name    TEXT NOT NULL UNIQUE,
  mime_type           TEXT NOT NULL,
  file_size_bytes     INTEGER NOT NULL CHECK (file_size_bytes > 0),
  file_sha256         TEXT NOT NULL,
  -- New uploads may live in a private Supabase Storage bucket. The nullable
  -- database bytes and stored_file_name retain compatibility with older rows.
  storage_object_path TEXT,
  file_data           BYTEA,

  status              offline_receipt_status NOT NULL DEFAULT 'submitted',
  reviewer_note       TEXT,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing deployments created this table before file_data existed.
ALTER TABLE offline_payment_receipts
  ADD COLUMN IF NOT EXISTS file_data BYTEA;

ALTER TABLE offline_payment_receipts
  ADD COLUMN IF NOT EXISTS storage_object_path TEXT;

CREATE INDEX IF NOT EXISTS idx_offline_payment_receipts_status
  ON offline_payment_receipts (status);

CREATE INDEX IF NOT EXISTS idx_offline_payment_receipts_booking_id
  ON offline_payment_receipts (booking_id);

CREATE OR REPLACE TRIGGER trg_offline_payment_receipts_updated_at
  BEFORE UPDATE ON offline_payment_receipts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- payment_review_flags - money that arrived but cannot be auto-settled
--   A payment that lands after its hold expired, an overpayment, or a deposit
--   whose balance was already swept before confirmation all need a human
--   decision (refund, credit, or accept). Recording them here keeps the funds
--   traceable instead of leaving them in an order nobody watches.
-- ---------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_review_reason') THEN
    CREATE TYPE payment_review_reason AS ENUM (
      'hold_expired_no_seat',
      'hold_expired_with_seat',
      'overpayment',
      'underpayment_after_window',
      'swept_before_confirmation'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_review_flags (
  id               BIGSERIAL PRIMARY KEY,

  order_id         BIGINT REFERENCES orders (id) ON DELETE CASCADE,
  booking_id       BIGINT REFERENCES bookings (id) ON DELETE CASCADE,
  payment_id       BIGINT REFERENCES payments (id) ON DELETE CASCADE,

  deposit_address  TEXT,
  tx_hash          TEXT,
  amount           NUMERIC(14, 2),

  reason           payment_review_reason NOT NULL,
  details          JSONB,
  -- What the automatic path already did, so the reviewer starts from facts.
  auto_action      TEXT,

  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_review_flags_unresolved
  ON payment_review_flags (created_at)
  WHERE resolved_at IS NULL;

-- A payment/booking pair can be flagged more than once across time, but a
-- single transaction can only ever be flagged once for a given reason.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_review_flags_unique_reason
  ON payment_review_flags (COALESCE(tx_hash, deposit_address), reason)
  WHERE tx_hash IS NOT NULL OR deposit_address IS NOT NULL;

-- ---------------------------------------------------------------------
-- Admin-editable event configuration overrides.
--   One row per event slug; the JSONB overrides object carries only the
--   fields the admin may change (name, tagline, event, price, seat
--   capacity, phone placeholder, contact). When no row exists the static
--   source of truth in ../../shared/eventConfig.js is used unchanged.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_config_overrides (
  slug       TEXT PRIMARY KEY,
  overrides  JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Column-type reconciliation.
--   CREATE TABLE IF NOT EXISTS above deliberately skips tables that already
--   exist, so it cannot repair a table whose status column is missing or
--   holds the wrong type. Each block below is a no-op once the table
--   already matches the canonical definition, which keeps this script
--   safe to re-run against an existing deployment without dropping data.
-- ---------------------------------------------------------------------

-- ticket_deliveries.status is repaired in the ticket_deliveries section
-- above, where it sits ahead of the index that depends on it.

-- payments.payment_method is repaired in the payments section above, where
-- it sits ahead of the indexes and constraints that depend on it.

-- Status columns must be the declared enums, not free-text: the enums are
-- what the CHECK-style guarantees and the service-layer status transitions
-- rely on. Repair only when the column is still a character type, so this
-- never rewrites a column that is already correct.
--
-- The DROP DEFAULT / SET DEFAULT pair is not cosmetic. A character default
-- such as 'pending'::character varying cannot be cast automatically to the
-- enum, so PostgreSQL rejects the type change while that default is still
-- attached. The restored default is the canonical one from the table above.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'payments' AND column_name = 'status'
       AND data_type = 'character varying'
  ) THEN
    ALTER TABLE payments ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE payments
      ALTER COLUMN status TYPE payment_status
      USING status::payment_status;
    ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'pending';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'orders' AND column_name = 'status'
       AND data_type = 'character varying'
  ) THEN
    ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE orders
      ALTER COLUMN status TYPE order_status
      USING status::order_status;
    ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'sweeps' AND column_name = 'status'
       AND data_type = 'character varying'
  ) THEN
    ALTER TABLE sweeps ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE sweeps
      ALTER COLUMN status TYPE sweep_status
      USING status::sweep_status;
    ALTER TABLE sweeps ALTER COLUMN status SET DEFAULT 'pending';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Constraint restoration.
--   Dropping a column takes every CHECK constraint that references it with
--   it, and CREATE TABLE IF NOT EXISTS above will not bring them back
--   because it skips the table entirely. Both of these guard real business
--   rules, so they are restored explicitly and only when missing.
-- ---------------------------------------------------------------------

-- Crypto fields (wallet address, tx hash) belong to USDT BEP20 only. Without
-- this, a mobile-money payment can carry them and the on-chain reconciler
-- would treat that payment as a crypto deposit.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_crypto_fields_chk'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_crypto_fields_chk CHECK (
        (payment_method = 'usdt_bep20')
        OR (wallet_address IS NULL AND tx_hash IS NULL)
      );
  END IF;
END $$;

-- confirmed_at is the timestamp the revenue and attribution reports read, so
-- it must never be set while the payment is not confirmed, nor left unset on
-- a confirmed payment. This runs after the status type conversion above,
-- because the constraint compares status against the enum.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_confirmed_at_chk'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_confirmed_at_chk CHECK (
        (status = 'confirmed' AND confirmed_at IS NOT NULL)
        OR         (status <> 'confirmed' AND confirmed_at IS NULL)
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Derived counter reconciliation.
--   seat_capacity.confirmed_count is derived state, not the truth. The truth
--   is the bookings table. A trigger can be missing entirely (recreating a
--   status enum drops it, because the trigger function depends on the type)
--   and once it is gone every insert, update and delete stops being counted,
--   so the counter silently drifts. Drift is expensive in both directions:
--   seats are withheld from sale for bookings that do not exist, or sold past
--   the cap.
--
--   Recompute rather than nudge by one, and only write when the stored value
--   actually disagrees, so a correct deployment is left untouched.
-- ---------------------------------------------------------------------

DO $$ DECLARE
  actual_confirmed_count INTEGER;
  stored_confirmed_count INTEGER;
BEGIN
  SELECT count(*) INTO actual_confirmed_count
    FROM bookings WHERE status = 'confirmed';

  SELECT confirmed_count INTO stored_confirmed_count
    FROM seat_capacity WHERE id = 1;

  IF stored_confirmed_count IS DISTINCT FROM actual_confirmed_count THEN
    UPDATE seat_capacity
       SET confirmed_count = actual_confirmed_count
     WHERE id = 1;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- reconciliation_runs - the durable history of every reconciliation pass.
--   A mismatch used to be written only to the console and a Telegram message,
--   so there was no way to answer afterwards what the operator was told, when,
--   or what the numbers were at that moment. Each run is persisted with the
--   three compared totals, the signed difference, and the full detail blob
--   (in-flight deposits, settled total, per-side mismatch flags, failure text).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id                      BIGSERIAL PRIMARY KEY,

  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 'balanced' | 'mismatch' | 'failed'. A failed run keeps its own status so
  -- an unreachable RPC is never silently recorded as a clean reconciliation.
  status                  TEXT NOT NULL
                            CHECK (status IN ('balanced', 'mismatch', 'failed')),

  -- Money observed on the deposit addresses of confirmed orders, including
  -- deposits that are in flight and not yet collected.
  observed_total          NUMERIC(14, 2),

  -- Money recorded in treasury_ledger as moved to the treasury wallet.
  ledger_total            NUMERIC(14, 2),

  -- What the treasury wallet actually holds, read from chain at run time.
  onchain_treasury_total  NUMERIC(14, 2),

  -- Signed difference between the ledger total and the settled observed total.
  -- Zero when the two sides agree, and NULL for a run that never produced a
  -- comparison, so an unreachable RPC is stored as unknown rather than as a
  -- clean reconciliation.
  mismatch_usdt           NUMERIC(14, 2) DEFAULT 0,

  -- In-flight deposits, settled total, per-side mismatch flags and any failure
  -- message, so the headline numbers stay queryable on their own.
  details                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_started_at
  ON reconciliation_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_status
  ON reconciliation_runs (status);

COMMIT;
