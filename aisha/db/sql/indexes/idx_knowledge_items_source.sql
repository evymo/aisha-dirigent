-- Index: idx_knowledge_items_source

CREATE INDEX idx_knowledge_items_source ON public.knowledge_items USING btree (source_type, source_id);
