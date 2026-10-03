-- Constraint: ai_model_registry_provider_registry_id_fkey
-- Table: ai_model_registry
-- Back-ported from migration (column + FK added post-baseline):
--   ai_model_registry.provider_registry_id → ai_provider_registry.id
-- Applied as a deferred constraint so ai_provider_registry exists first.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_model_registry_provider_registry_id_fkey'
  ) THEN
    ALTER TABLE public.ai_model_registry
      ADD CONSTRAINT ai_model_registry_provider_registry_id_fkey
      FOREIGN KEY (provider_registry_id)
      REFERENCES public.ai_provider_registry(id);
  END IF;
END $$;
