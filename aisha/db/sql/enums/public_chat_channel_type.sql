-- Enum: public_chat_channel_type

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'public_chat_channel_type') THEN
    CREATE TYPE public_chat_channel_type AS ENUM (
      'web_widget',
  'whatsapp',
  'telegram',
  'messenger',
  'email',
  'api'
    );
  END IF;
END $$;
