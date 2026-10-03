-- Table: specialist_pricing
-- Specialist hourly rates, availability, and booking configuration.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS specialist_pricing (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  hourly_rate numeric(10,2) NOT NULL DEFAULT 3250.00,
  min_block_hours integer NOT NULL DEFAULT 4,
  currency text,
  availability_status availability_status NOT NULL DEFAULT 'available',
  max_concurrent_projects integer NOT NULL DEFAULT 3,
  conditions_text text,
  instant_booking boolean NOT NULL DEFAULT false,
  response_time_hours integer NOT NULL DEFAULT 24,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT specialist_pricing_partner_id_key UNIQUE (partner_id),
  CONSTRAINT specialist_pricing_partner_id_fkey FOREIGN KEY (partner_id)
    REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT specialist_pricing_hourly_rate_positive CHECK (hourly_rate > 0),
  CONSTRAINT specialist_pricing_min_block_positive CHECK (min_block_hours >= 1),
  CONSTRAINT specialist_pricing_response_time_positive CHECK (response_time_hours >= 1)
);

ALTER TABLE specialist_pricing ENABLE ROW LEVEL SECURITY;

