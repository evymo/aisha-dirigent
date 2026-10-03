CREATE TABLE IF NOT EXISTS public.intranet_chat_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES intranet_chat_channels(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member'
                CHECK (role IN ('member', 'admin')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

ALTER TABLE public.intranet_chat_members ENABLE ROW LEVEL SECURITY;
