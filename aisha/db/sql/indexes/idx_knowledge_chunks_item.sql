-- Index: idx_knowledge_chunks_item

CREATE INDEX idx_knowledge_chunks_item ON public.knowledge_chunks USING btree (knowledge_item_id);
