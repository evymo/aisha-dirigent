-- Index: idx_knowledge_items_tags

CREATE INDEX idx_knowledge_items_tags ON public.knowledge_items USING gin (ai_context_tags);
