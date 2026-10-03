-- Table: agent_decision_trees

CREATE TABLE IF NOT EXISTS public.agent_decision_trees (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  agent_id uuid NOT NULL,
  tree_name text NOT NULL,
  display_name text,
  description text,
  tree_definition jsonb DEFAULT '{}'::jsonb NOT NULL,
  trigger_context text DEFAULT 'routing'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  PRIMARY KEY (id)
);

ALTER TABLE public.agent_decision_trees ENABLE ROW LEVEL SECURITY;
