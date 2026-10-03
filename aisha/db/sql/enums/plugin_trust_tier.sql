-- Enum: plugin_trust_tier
-- Purpose: Trust tier governing a plugin's capability grants in the sandbox.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plugin_trust_tier') THEN
    CREATE TYPE public.plugin_trust_tier AS ENUM (
      'internal',
      'partner',
      'external'
    );
  END IF;
END $$;
