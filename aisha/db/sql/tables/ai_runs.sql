-- Table: ai_runs

CREATE TABLE IF NOT EXISTS public.ai_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL,
  -- §16/§20 multi-tenancy invariant: every run carries a story (chargeback/RLS/audit).
  story_id uuid NOT NULL REFERENCES public.partner_stories ON DELETE CASCADE,
  actor_user_id uuid,
  route_plan jsonb,
  status text DEFAULT 'running'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  cost_total_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  workflow_definition_id uuid,
  -- Step 2 chat_message_eval_link (added by 20260518220000_chat_message_eval_link.sql)
  faithfulness_score_estimate numeric(4, 3)
    CHECK (faithfulness_score_estimate IS NULL OR faithfulness_score_estimate BETWEEN 0 AND 1),
  citation_chunk_ids uuid[] DEFAULT '{}'::uuid[],
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
