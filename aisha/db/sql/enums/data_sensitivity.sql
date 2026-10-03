-- Data Sensitivity Enum (§11 residency)
-- Drives the on-prem residency gate: a 'confidential' classification forces
-- local-only backends (canUseCloudApis=false). DB-driven source of truth for
-- the svc-ai-chat detectDataSensitivity classifier (was a hardcoded literal).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_sensitivity') THEN
    CREATE TYPE public.data_sensitivity AS ENUM ('public', 'internal', 'confidential');
  END IF;
END $$;
