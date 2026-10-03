-- Table: node_factory_requests
-- Purpose: Tracks self-orchestration requests from Aisha NodeFactory
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS node_factory_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_by uuid,
  node_type text NOT NULL,
  node_name text NOT NULL,
  specification jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_code text,
  validation_result jsonb,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  n8n_workflow_id text,
  deployed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT node_factory_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT node_factory_requests_status_check CHECK (status IN ('pending', 'generating', 'validating', 'testing', 'deploying', 'deployed', 'failed', 'cancelled'))
);

ALTER TABLE node_factory_requests ENABLE ROW LEVEL SECURITY;
