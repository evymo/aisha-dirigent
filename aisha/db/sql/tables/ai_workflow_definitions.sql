-- Table: ai_workflow_definitions

CREATE TABLE IF NOT EXISTS public.ai_workflow_definitions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  display_name text DEFAULT ''::text NOT NULL,
  description text DEFAULT ''::text NOT NULL,
  graph jsonb DEFAULT '{}'::jsonb NOT NULL,
  context text DEFAULT 'chat'::text NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_workflow_definitions ENABLE ROW LEVEL SECURITY;
