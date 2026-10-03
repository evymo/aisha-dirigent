-- Table: stripe_disputes

CREATE TABLE IF NOT EXISTS public.stripe_disputes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  stripe_dispute_id text NOT NULL,
  stripe_charge_id text NOT NULL,
  stripe_payment_intent_id text,
  order_id uuid REFERENCES public.orders ON DELETE SET NULL,
  user_id uuid REFERENCES aisha_auth.users ON DELETE SET NULL,
  amount bigint NOT NULL,
  currency text,
  reason text,
  status text DEFAULT 'needs_response'::text NOT NULL,
  evidence_due_by timestamp with time zone,
  is_charge_refundable boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  opened_at timestamp with time zone DEFAULT now() NOT NULL,
  closed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.stripe_disputes ENABLE ROW LEVEL SECURITY;
