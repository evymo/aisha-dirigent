-- Constraint: knowledge_embeddings_locale_fkey
-- Table: knowledge_embeddings
-- RAG locale axis (Brick3): locale → supported_languages.code. NO ON DELETE
-- CASCADE (default NO ACTION) — removing a language must NEVER cascade-delete
-- embeddings. The conname guard makes the back-port idempotent for existing DBs.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_embeddings_locale_fkey'
  ) THEN
    ALTER TABLE public.knowledge_embeddings
      ADD CONSTRAINT knowledge_embeddings_locale_fkey
      FOREIGN KEY (locale)
      REFERENCES public.supported_languages(code);
  END IF;
END $$;
