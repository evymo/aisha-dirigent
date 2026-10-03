-- Index: idx_knowledge_embeddings_item

CREATE INDEX idx_knowledge_embeddings_item ON public.knowledge_embeddings USING btree (knowledge_item_id);
