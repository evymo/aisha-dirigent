-- Table: expert_rule_versions

CREATE TABLE IF NOT EXISTS public.expert_rule_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.expert_rules ON DELETE CASCADE,
  version_no integer NOT NULL,
  body_markdown text NOT NULL,
  ai_instructions text,
  change_note text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  content_hash text,
  PRIMARY KEY (id)
);

ALTER TABLE public.expert_rule_versions ENABLE ROW LEVEL SECURITY;
