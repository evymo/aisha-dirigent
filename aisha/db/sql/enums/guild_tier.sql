-- Enum: guild_tier

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'guild_tier') THEN
    CREATE TYPE guild_tier AS ENUM (
      'apprentice',
  'journeyman',
  'master',
  'grandmaster'
    );
  END IF;
END $$;
