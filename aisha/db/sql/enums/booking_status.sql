-- Type: booking_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
    CREATE TYPE booking_status AS ENUM (
      'pending_payment', 'paid', 'confirmed', 'in_progress',
      'completed', 'cancelled', 'disputed', 'refunded'
    );
  END IF;
END $$;
