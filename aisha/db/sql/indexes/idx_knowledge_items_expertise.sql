-- Index: idx_knowledge_items_expertise

CREATE INDEX idx_knowledge_items_expertise ON public.knowledge_items USING btree (expertise_area_id);
