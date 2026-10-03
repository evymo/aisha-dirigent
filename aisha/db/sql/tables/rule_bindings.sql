-- Table: rule_bindings

CREATE TABLE IF NOT EXISTS public.rule_bindings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.expert_rules ON DELETE CASCADE,
  target_type rule_binding_target_type NOT NULL,
  target_id uuid,
  binding_type text DEFAULT 'knowledge_source'::text NOT NULL,
  priority integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.rule_bindings ENABLE ROW LEVEL SECURITY;
