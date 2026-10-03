-- Table: distribution_forecast_items
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS distribution_forecast_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  forecast_month date NOT NULL,
  study_id uuid NOT NULL,
  product_id uuid NOT NULL,
  total_members int4 NOT NULL DEFAULT 0,
  vip_members int4 NOT NULL DEFAULT 0,
  required_packages numeric NOT NULL DEFAULT 0,
  compensated_value numeric NOT NULL DEFAULT 0,
  production_status text NOT NULL DEFAULT 'planning'::text,
  reported_deviation_percent numeric,
  deviation_sample_size int4,
  linked_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT distribution_forecast_items_forecast_month_study_id_product_key UNIQUE (product_id, study_id, forecast_month),
  CONSTRAINT distribution_forecast_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT distribution_forecast_items_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE distribution_forecast_items ENABLE ROW LEVEL SECURITY;
