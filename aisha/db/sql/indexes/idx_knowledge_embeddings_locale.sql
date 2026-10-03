-- Index: idx_knowledge_embeddings_locale (Brick3 RAG locale axis)

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_locale ON public.knowledge_embeddings USING btree (locale);
