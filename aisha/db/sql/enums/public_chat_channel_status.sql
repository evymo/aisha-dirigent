-- Enum: public_chat_channel_status

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'public_chat_channel_status') THEN
    CREATE TYPE public_chat_channel_status AS ENUM (
      'draft',
  'active',
  'paused',
  'archived'
    );
  END IF;
END $$;
