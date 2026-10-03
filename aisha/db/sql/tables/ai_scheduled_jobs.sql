-- Table: ai_scheduled_jobs

CREATE TABLE IF NOT EXISTS public.ai_scheduled_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  display_name text,
  description text DEFAULT ''::text,
  cron_expression text NOT NULL,
  job_type text DEFAULT 'ai_analysis'::text NOT NULL,
  agent_name text,
  workflow_name text,
  job_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  last_run_at timestamp with time zone,
  last_run_status text,
  last_run_duration_ms integer,
  next_run_at timestamp with time zone,
  total_runs integer DEFAULT 0,
  successful_runs integer DEFAULT 0,
  failed_runs integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  payload jsonb DEFAULT '{}'::jsonb,
  queue_name text,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_scheduled_jobs ENABLE ROW LEVEL SECURITY;
