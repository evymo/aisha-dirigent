-- Index: idx_knowledge_embeddings_model_v2_registry (Brick2-guard model identity, v2)
-- Supports the deferred set-based backfill join + model-scoped analytics over the v2
-- ai_model_registry FK column. Partial on NOT NULL — sparse until the v2 backfill fills.

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_model_v2_registry
  ON public.knowledge_embeddings USING btree (model_v2_registry_id)
  WHERE model_v2_registry_id IS NOT NULL;
