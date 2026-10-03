-- Index: idx_knowledge_embeddings_v2_pending
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_knowledge_embeddings_v2_pending ON public.knowledge_embeddings USING btree (v2_status, chunk_id) WHERE (v2_status = 'pending'::text);
