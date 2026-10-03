-- Enum: sync_operation_outcome
-- Purpose: Outcome of a story sync operation in the provenance ledger.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_operation_outcome') THEN
    CREATE TYPE public.sync_operation_outcome AS ENUM (
      'pending',
      'success',
      'partial',
      'conflict',
      'failed',
      'rejected'
    );
  END IF;
END $$;
