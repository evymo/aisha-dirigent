-- Table: production_metrics
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid,
  metric_name text ,
  metric_value numeric(15,4),
  unit text,
  recorded_at timestamptz DEFAULT now(),
  metric_date date,
  product_id uuid,
  study_id uuid,
  vials_produced int4,
  vials_released int4,
  vials_allocated_study int4,
  vials_allocated_retail int4,
  qc_pass_rate numeric,
  deviations_count int4,
  active_participants int4,
  dropout_count int4,
  adverse_events_count int4,
  adherence_rate numeric,
  outcome_improvement_rate numeric,
  risk_score numeric,
  token_eligible_amount numeric,
  tokens_minted numeric,
  tokens_locked numeric,
  created_at timestamptz,
  updated_at timestamptz,
  metadata jsonb,
  PRIMARY KEY (id),
  CONSTRAINT production_metrics_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT production_metrics_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT production_metrics_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id)
);

ALTER TABLE production_metrics ENABLE ROW LEVEL SECURITY;
