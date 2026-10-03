-- Table: token_production_events
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS token_production_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.production_batches ON DELETE SET NULL,
  event_type text NOT NULL,
  token_amount numeric(20,8),
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  milestone_id uuid,
  study_id uuid,
  token_type text,
  conditions_met bool,
  is_locked bool,
  lock_until timestamptz,
  lock_condition text,
  unlocked_at timestamptz,
  processed_at timestamptz,
  transaction_id text,
  blockchain_tx_hash text,
  PRIMARY KEY (id),
  CONSTRAINT token_production_events_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id)
);

ALTER TABLE token_production_events ENABLE ROW LEVEL SECURITY;
