-- Table: public_chat_messages
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.public_chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES public.public_chat_sessions(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          text NOT NULL,
  metadata         jsonb DEFAULT '{}'::jsonb,  -- model used, tokens, latency_ms, tools_called
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_chat_messages ENABLE ROW LEVEL SECURITY;
