-- Index: idx_knowledge_embeddings_model_registry (Brick2-guard model identity)
-- Supports the deferred set-based backfill join + model-scoped analytics over the v1
-- ai_model_registry FK column. Partial on NOT NULL so it stays small while legacy rows
-- are unbackfilled.

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_model_registry
  ON public.knowledge_embeddings USING btree (model_registry_id)
  WHERE model_registry_id IS NOT NULL;
