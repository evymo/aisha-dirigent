-- Index: idx_knowledge_items_type

CREATE INDEX idx_knowledge_items_type ON public.knowledge_items USING btree (item_type);
