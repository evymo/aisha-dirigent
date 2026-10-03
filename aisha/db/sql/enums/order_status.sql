-- Enum: order_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM (
      'pending',
  'awaiting_payment',
  'paid',
  'payment_failed',
  'payment_expired',
  'processing',
  'shipped',
  'in_transit',
  'delivered',
  'cancelled',
  'refunded',
  'partially_refunded'
    );
  END IF;
END $$;

-- Values: pending, awaiting_payment, paid, payment_failed, payment_expired, processing, shipped, in_transit, delivered, cancelled, refunded, partially_refunded
