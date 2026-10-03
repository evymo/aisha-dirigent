-- Table: distribution_schedule
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS distribution_schedule (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scheduled_date date NOT NULL,
  scheduled_time time DEFAULT '14:00:00'::time without time zone,
  status text DEFAULT 'pending'::text,
  orders_count int4 DEFAULT 0,
  processed_count int4 DEFAULT 0,
  failed_count int4 DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  created_by uuid,
  processed_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT distribution_schedule_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT distribution_schedule_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE distribution_schedule ENABLE ROW LEVEL SECURITY;
