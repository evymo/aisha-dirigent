-- Index: knowledge_embeddings_chunk_id_key

-- Widened with locale (Brick3): per-locale embeddings of one chunk may coexist.
-- Behavior-neutral today (all rows locale='global').
CREATE UNIQUE INDEX knowledge_embeddings_chunk_id_key ON public.knowledge_embeddings USING btree (chunk_id, locale);
