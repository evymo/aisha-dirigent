-- Table: ai_session_memory

CREATE TABLE IF NOT EXISTS public.ai_session_memory (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb NOT NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_session_memory ENABLE ROW LEVEL SECURITY;
