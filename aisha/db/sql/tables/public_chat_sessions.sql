-- Table: public_chat_sessions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.public_chat_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id       uuid NOT NULL REFERENCES public.public_chat_channels(id) ON DELETE CASCADE,
  visitor_id       text NOT NULL,  -- anonymous fingerprint or cookie ID
  visitor_metadata jsonb DEFAULT '{}'::jsonb,  -- name, email if provided
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'escalated')),
  message_count    int4 NOT NULL DEFAULT 0,
  last_message_at  timestamptz,
  lead_captured    boolean NOT NULL DEFAULT false,
  escalated_to     text,  -- agent/workflow name if escalated
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_chat_sessions ENABLE ROW LEVEL SECURITY;
