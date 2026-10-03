-- Table: ai_proactive_runs

CREATE TABLE IF NOT EXISTS public.ai_proactive_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  trigger_definition_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  source_record_id uuid,
  source_data jsonb,
  status text DEFAULT 'pending'::text NOT NULL,
  ai_run_id uuid REFERENCES public.ai_runs ON DELETE SET NULL,
  output_text text,
  output_data jsonb,
  action_taken text,
  action_result jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  duration_ms integer,
  tokens_input integer DEFAULT 0,
  tokens_output integer DEFAULT 0,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_proactive_runs ENABLE ROW LEVEL SECURITY;
