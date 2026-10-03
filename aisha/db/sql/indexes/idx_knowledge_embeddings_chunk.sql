-- Index: idx_knowledge_embeddings_chunk

CREATE INDEX idx_knowledge_embeddings_chunk ON public.knowledge_embeddings USING btree (chunk_id);
