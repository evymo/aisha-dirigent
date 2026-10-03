CREATE TABLE IF NOT EXISTS public.intranet_chat_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  channel_type  text NOT NULL DEFAULT 'general'
                CHECK (channel_type IN ('general', 'team', 'project', 'direct')),
  description   text,
  is_default    boolean NOT NULL DEFAULT false,
  is_archived   boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES aisha_auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.intranet_chat_channels ENABLE ROW LEVEL SECURITY;
