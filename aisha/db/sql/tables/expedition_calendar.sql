-- Table: expedition_calendar
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS expedition_calendar (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  expedition_date date NOT NULL,
  cut_off_date date NOT NULL,
  product_id uuid,
  study_id uuid,
  planned_shipments int4 NOT NULL DEFAULT 0,
  confirmed_shipments int4 NOT NULL DEFAULT 0,
  packed_shipments int4 NOT NULL DEFAULT 0,
  sent_shipments int4 NOT NULL DEFAULT 0,
  allocated_batches jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'planned'::text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT expedition_calendar_expedition_date_product_id_study_id_key UNIQUE (product_id, expedition_date, study_id),
  CONSTRAINT expedition_calendar_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT expedition_calendar_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT expedition_calendar_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL
);

ALTER TABLE expedition_calendar ENABLE ROW LEVEL SECURITY;
