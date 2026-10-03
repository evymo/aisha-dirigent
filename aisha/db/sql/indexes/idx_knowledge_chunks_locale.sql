-- Index: idx_knowledge_chunks_locale (Brick3 RAG locale axis)

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_locale ON public.knowledge_chunks USING btree (locale);
