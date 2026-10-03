-- Table: production_token_events
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_token_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.production_batches ON DELETE SET NULL,
  step_id uuid REFERENCES public.production_protocol_steps ON DELETE SET NULL,
  event_type text NOT NULL,
  token_amount numeric(20,8),
  participant_id uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  protocol_step_id uuid,
  token_type text,
  amount numeric,
  reason text,
  description text,
  reference_volume numeric,
  loss_volume numeric,
  created_by uuid,
  PRIMARY KEY (id),
  CONSTRAINT production_token_events_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_token_events ENABLE ROW LEVEL SECURITY;
