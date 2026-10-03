-- Table: distribution_calendar
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS distribution_calendar (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scheduled_date date NOT NULL,
  scheduled_time time DEFAULT '14:00:00'::time without time zone,
  status text NOT NULL DEFAULT 'pending'::text,
  orders_count int4 DEFAULT 0,
  processed_count int4 DEFAULT 0,
  failed_count int4 DEFAULT 0,
  notes text,
  orders jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (id)
);

ALTER TABLE distribution_calendar ENABLE ROW LEVEL SECURITY;
