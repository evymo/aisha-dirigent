-- Table: ai_workflow_node_runs

CREATE TABLE IF NOT EXISTS public.ai_workflow_node_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL REFERENCES public.ai_runs ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  agent_name text,
  status text DEFAULT 'pending'::text NOT NULL,
  input_data jsonb,
  output_data jsonb,
  transition_key text,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_ms integer,
  tokens_input integer DEFAULT 0,
  tokens_output integer DEFAULT 0,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_workflow_node_runs ENABLE ROW LEVEL SECURITY;
