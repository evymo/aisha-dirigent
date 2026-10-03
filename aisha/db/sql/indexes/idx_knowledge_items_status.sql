-- Index: idx_knowledge_items_status

CREATE INDEX idx_knowledge_items_status ON public.knowledge_items USING btree (status, visibility);
