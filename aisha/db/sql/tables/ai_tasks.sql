-- Table: ai_tasks

CREATE TABLE IF NOT EXISTS public.ai_tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  task_type text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  input jsonb DEFAULT '{}'::jsonb NOT NULL,
  result jsonb,
  error_message text,
  progress integer DEFAULT 0 NOT NULL,
  max_steps integer DEFAULT 10,
  current_step integer DEFAULT 0,
  run_id uuid REFERENCES public.ai_runs ON DELETE SET NULL,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;
