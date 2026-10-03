-- Index: idx_expert_rules_content_embedding

CREATE INDEX IF NOT EXISTS idx_expert_rules_content_embedding ON public.expert_rules USING hnsw (content_embedding vector_cosine_ops) WITH (m='16', ef_construction='64');
