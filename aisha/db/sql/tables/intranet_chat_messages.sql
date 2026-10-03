CREATE TABLE IF NOT EXISTS public.intranet_chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES intranet_chat_channels(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES aisha_auth.users(id),
  content       text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_edited     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.intranet_chat_messages ENABLE ROW LEVEL SECURITY;
