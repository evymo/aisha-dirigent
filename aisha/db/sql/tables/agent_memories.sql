-- Table: agent_memories

CREATE TABLE IF NOT EXISTS public.agent_memories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  agent_slug text NOT NULL,
  user_id uuid REFERENCES aisha_auth.users ON DELETE SET NULL,
  memory_type text NOT NULL,
  content text NOT NULL,
  importance integer DEFAULT 5 NOT NULL,
  source_run_id uuid,
  embedding vector(1024),
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.agent_memories ENABLE ROW LEVEL SECURITY;
