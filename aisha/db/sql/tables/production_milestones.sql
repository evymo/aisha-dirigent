-- Table: production_milestones
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  milestone_name text ,
  description text,
  achieved_at timestamptz DEFAULT now(),
  milestone_code text,
  name text,
  achieved_by uuid,
  protocol_summary text,
  blockchain_tx_hash text,
  blockchain_recorded_at timestamptz,
  triggers_token_event bool,
  token_event_type text,
  token_event_processed_at timestamptz,
  notes text,
  created_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT production_milestones_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE
);

ALTER TABLE production_milestones ENABLE ROW LEVEL SECURITY;
