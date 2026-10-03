-- Index: idx_knowledge_embeddings_v2_vector
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_knowledge_embeddings_v2_vector ON public.knowledge_embeddings USING hnsw (embedding_v2 halfvec_cosine_ops) WITH (m='16', ef_construction='64');
