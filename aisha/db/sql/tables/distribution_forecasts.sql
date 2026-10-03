-- Table: distribution_forecasts
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS distribution_forecasts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  forecast_month date NOT NULL,
  product_id uuid ,
  total_members int4 NOT NULL DEFAULT 0,
  total_packages_needed numeric NOT NULL DEFAULT 0,
  reserved_packages numeric DEFAULT 0,
  shipped_packages numeric DEFAULT 0,
  status text DEFAULT 'forecast'::text,
  production_batch_id uuid REFERENCES public.production_batches ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  forecast_date date NOT NULL,
  production_status text DEFAULT 'planned'::text,
  expected_demand int4 DEFAULT 0,
  production_capacity int4 DEFAULT 0,
  inventory_level int4 DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT distribution_forecasts_forecast_month_product_id_key UNIQUE (forecast_month, product_id),
  CONSTRAINT distribution_forecasts_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

ALTER TABLE distribution_forecasts ENABLE ROW LEVEL SECURITY;
