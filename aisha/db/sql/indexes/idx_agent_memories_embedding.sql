-- Index: idx_agent_memories_embedding
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding ON public.agent_memories USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');
