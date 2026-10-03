-- Table: ai_eval_runs

CREATE TABLE IF NOT EXISTS public.ai_eval_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  trigger_type text NOT NULL,
  agent_config_id uuid,
  agent_config_version integer,
  status text DEFAULT 'pending'::text NOT NULL,
  total_examples integer DEFAULT 0 NOT NULL,
  completed_examples integer DEFAULT 0 NOT NULL,
  avg_relevance numeric,
  avg_groundedness numeric,
  avg_safety numeric,
  avg_coherence numeric,
  avg_overall numeric,
  previous_run_id uuid,
  score_delta numeric,
  metadata jsonb DEFAULT '{}'::jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_eval_runs ENABLE ROW LEVEL SECURITY;
