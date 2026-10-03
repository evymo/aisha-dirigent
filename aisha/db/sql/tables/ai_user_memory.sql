-- Table: ai_user_memory

CREATE TABLE IF NOT EXISTS public.ai_user_memory (
  user_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb NOT NULL,
  confidence real DEFAULT 1.0 NOT NULL,
  source text DEFAULT 'inferred'::text NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.ai_user_memory ENABLE ROW LEVEL SECURITY;
