-- Table: dirigent_nudges
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
-- Purpose: Async push channel from AISHA Dirigent backend to Claude Code Stop hook.
--          Backend (n8n WF_DIRIGENT_AGENT, scheduled flows, compliance engine) writes
--          nudges; Stop hook of dirigent-supervisor edge fn drains them and injects
--          via additionalContext to the agent. Equivalent of aisha-push.ts in VS Code.

CREATE TABLE IF NOT EXISTS public.dirigent_nudges (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid REFERENCES public.partner_stories ON DELETE SET NULL,
  conversation_id text,
  event_origin text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  consumed_at timestamp with time zone,
  expires_at timestamp with time zone DEFAULT (now() + interval '1 hour') NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT dirigent_nudges_severity_check CHECK (severity IN ('info','warn','goal-correction')),
  CONSTRAINT dirigent_nudges_origin_check CHECK (event_origin IN
    ('wf_dirigent_agent','compliance_engine','goal_evaluator','manual','scheduled'))
);

ALTER TABLE public.dirigent_nudges ENABLE ROW LEVEL SECURITY;
