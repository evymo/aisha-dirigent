-- Table: payment_sessions
-- Tracks Stripe checkout sessions for orders and subscriptions

CREATE TABLE IF NOT EXISTS payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL UNIQUE,
  session_type text NOT NULL, -- 'order_checkout', 'subscription_checkout'
  reference_type text NOT NULL, -- 'order', 'subscription'
  reference_id uuid NOT NULL,
  amount numeric(10,2),
  currency text,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'expired'
  metadata jsonb DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;

-- Indexes are defined in separate files under supabase/sql/indexes/

-- Comments
COMMENT ON TABLE payment_sessions IS 'Tracks Stripe checkout sessions for payment processing';
COMMENT ON COLUMN payment_sessions.session_type IS 'Type of checkout: order_checkout, subscription_checkout';
COMMENT ON COLUMN payment_sessions.reference_type IS 'What this payment is for: order, subscription';
COMMENT ON COLUMN payment_sessions.reference_id IS 'ID of the order or subscription';
