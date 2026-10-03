-- Index: idx_knowledge_items_source_slug

CREATE INDEX idx_knowledge_items_source_slug ON public.knowledge_items USING btree (source_slug);
