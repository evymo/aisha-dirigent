-- Table: public_chat_channel_history
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.public_chat_channel_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        uuid NOT NULL REFERENCES public.public_chat_channels(id) ON DELETE CASCADE,
  version           int4 NOT NULL,
  configuration_snapshot jsonb NOT NULL,
  change_summary    text,
  changed_by        uuid REFERENCES aisha_auth.users(id),
  changed_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_chat_channel_history ENABLE ROW LEVEL SECURITY;
