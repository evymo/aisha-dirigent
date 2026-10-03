-- Table: moderation_decisions

CREATE TABLE IF NOT EXISTS public.moderation_decisions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL REFERENCES public.moderation_sessions ON DELETE CASCADE,
  decision_type text NOT NULL,
  severity text DEFAULT 'info'::text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb NOT NULL,
  recommendation text NOT NULL,
  evidence jsonb DEFAULT '{}'::jsonb,
  accepted boolean,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.moderation_decisions ENABLE ROW LEVEL SECURITY;
