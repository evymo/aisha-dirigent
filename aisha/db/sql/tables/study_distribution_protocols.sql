-- Table: study_distribution_protocols
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_distribution_protocols (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  product_id uuid NOT NULL,
  dose_amount numeric NOT NULL,
  dose_unit text NOT NULL DEFAULT 'drops'::text,
  doses_per_day int4 NOT NULL DEFAULT 1,
  dose_timing text[] DEFAULT ARRAY['morning'::text],
  take_with_food bool DEFAULT false,
  duration_days int4,
  start_day int4 DEFAULT 1,
  units_per_package int4 NOT NULL DEFAULT 30,
  packages_per_month numeric NOT NULL DEFAULT 1,
  instructions_key text,
  contraindications text[],
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  arm_code text,
  arm_name_key text,
  is_placebo bool DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT study_distribution_protocols_study_id_product_id_key UNIQUE (product_id, study_id),
  CONSTRAINT study_distribution_protocols_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT study_distribution_protocols_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE study_distribution_protocols ENABLE ROW LEVEL SECURITY;
