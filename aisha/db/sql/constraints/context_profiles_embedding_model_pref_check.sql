-- Constraint: context_profiles_embedding_model_pref_check
-- Table: context_profiles
-- Back-ported from migration: embedding_model_pref must be one of the
-- supported embedding generations ('v1' legacy vector, 'v2' halfvec).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'context_profiles_embedding_model_pref_check'
  ) THEN
    ALTER TABLE public.context_profiles
      ADD CONSTRAINT context_profiles_embedding_model_pref_check
      CHECK (embedding_model_pref = ANY (ARRAY['v1'::text, 'v2'::text]));
  END IF;
END $$;
