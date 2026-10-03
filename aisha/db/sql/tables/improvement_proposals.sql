-- Table: improvement_proposals

CREATE TABLE IF NOT EXISTS public.improvement_proposals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  proposal_type text,
  status text DEFAULT 'draft'::text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  current_value jsonb DEFAULT '{}'::jsonb,
  proposed_value jsonb DEFAULT '{}'::jsonb,
  rationale text,
  source text DEFAULT 'manual'::text,
  eval_run_id uuid,
  priority integer DEFAULT 5,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_note text,
  applied_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  agent_slug text,
  category text DEFAULT 'general'::text,
  risk_level text DEFAULT 'low'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  run_id uuid REFERENCES public.ai_runs ON DELETE SET NULL,
  pr_number integer,
  pr_url text,
  resolved_at timestamp with time zone,
  anomaly_key text,
  outcome jsonb,
  PRIMARY KEY (id)
);

ALTER TABLE public.improvement_proposals ENABLE ROW LEVEL SECURITY;
