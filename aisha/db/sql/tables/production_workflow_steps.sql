-- Table: production_workflow_steps
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS production_workflow_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  step_name text NOT NULL,
  step_order int4 NOT NULL,
  status text DEFAULT 'pending'::text,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  notes text,
  created_at timestamptz DEFAULT now(),
  step_code text,
  description text,
  assigned_role text,
  assigned_user_id uuid,
  input_data jsonb,
  output_data jsonb,
  has_deviation bool,
  deviation_notes text,
  updated_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT production_workflow_steps_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT production_workflow_steps_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE production_workflow_steps ENABLE ROW LEVEL SECURITY;
