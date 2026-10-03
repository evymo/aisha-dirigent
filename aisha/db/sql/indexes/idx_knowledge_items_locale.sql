-- Index: idx_knowledge_items_locale (Brick3 RAG locale axis)

CREATE INDEX IF NOT EXISTS idx_knowledge_items_locale ON public.knowledge_items USING btree (locale);
