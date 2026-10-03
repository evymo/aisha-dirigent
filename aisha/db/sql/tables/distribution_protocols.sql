-- Table: distribution_protocols
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS distribution_protocols (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid,
  study_id uuid,
  name text NOT NULL,
  description text,
  dose_amount numeric NOT NULL DEFAULT 3,
  dose_unit text NOT NULL DEFAULT 'drops'::text,
  doses_per_day int4 NOT NULL DEFAULT 3,
  dose_timing text[] DEFAULT ARRAY['morning'::text, 'noon'::text, 'evening'::text],
  arm_code text,
  is_active bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name_key text,
  description_key text,
  PRIMARY KEY (id),
  CONSTRAINT distribution_protocols_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT distribution_protocols_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id)
);

ALTER TABLE distribution_protocols ENABLE ROW LEVEL SECURITY;
