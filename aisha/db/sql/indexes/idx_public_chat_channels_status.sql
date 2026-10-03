-- Index: idx_public_chat_channels_status
-- Table: public_chat_channels

CREATE INDEX IF NOT EXISTS idx_public_chat_channels_status
  ON public.public_chat_channels(status) WHERE status = 'active';
