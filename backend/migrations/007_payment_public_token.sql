-- The payment page used to be addressed by the sequential payments.id, which
-- let anyone walk /pay/126, /pay/127, ... and reach another attendee's payment.
-- public_token replaces that guessable identifier in attendee-facing URLs.
--
-- gen_random_uuid() is built into PostgreSQL 13+ and returns a UUIDv4 (122
-- random bits), so no extension is required.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS public_token UUID;

-- Backfill every existing payment before the column becomes mandatory.
UPDATE payments
   SET public_token = gen_random_uuid()
 WHERE public_token IS NULL;

ALTER TABLE payments ALTER COLUMN public_token SET DEFAULT gen_random_uuid();
ALTER TABLE payments ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_public_token
  ON payments (public_token);
