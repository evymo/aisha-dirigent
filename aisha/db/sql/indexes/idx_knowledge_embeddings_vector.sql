-- Index: idx_knowledge_embeddings_vector

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector ON public.knowledge_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');
