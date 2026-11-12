-- A deposit was identified by its transaction hash alone, so a transaction
-- that carried more than one USDT Transfer log could only ever record the first
-- one: the second INSERT hit the UNIQUE (tx_hash) constraint and was silently
-- discarded by ON CONFLICT DO NOTHING. That is a real case on BSC - a batch
-- payout, a router, or one payer paying two tickets from the same wallet - and
-- it lost the second attendee's payment.
--
-- A Transfer log is identified by its transaction hash AND its log index, so
-- the pair becomes the identity of a deposit. Existing rows keep log_index 0,
-- which is correct: the only row ever stored for a transaction was the first
-- matching log.

ALTER TABLE deposits_observed
  ADD COLUMN IF NOT EXISTS log_index INTEGER NOT NULL DEFAULT 0;

ALTER TABLE deposits_observed
  DROP CONSTRAINT IF EXISTS deposits_observed_tx_hash_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_deposits_observed_tx_hash_log_index
  ON deposits_observed (tx_hash, log_index);
