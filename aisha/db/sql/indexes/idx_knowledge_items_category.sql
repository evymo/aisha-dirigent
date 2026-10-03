-- Index: idx_knowledge_items_category

CREATE INDEX idx_knowledge_items_category ON public.knowledge_items USING btree (category);
