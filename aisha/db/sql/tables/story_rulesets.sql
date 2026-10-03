-- Table: story_rulesets

CREATE TABLE IF NOT EXISTS public.story_rulesets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL REFERENCES public.partner_stories ON DELETE CASCADE,
  ruleset_fingerprint text NOT NULL,
  rule_ids uuid[] NOT NULL,
  rule_versions jsonb NOT NULL,
  context_profile text DEFAULT 'repo_plus_rules'::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text DEFAULT 'aisha'::text NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.story_rulesets ENABLE ROW LEVEL SECURITY;
