ALTER TABLE offline_payment_receipts
  ADD COLUMN IF NOT EXISTS storage_object_path TEXT;
