-- Index: idx_knowledge_chunks_needs_prefix
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_knowledge_chunks_needs_prefix ON public.knowledge_chunks USING btree (knowledge_item_id) WHERE (contextual_prefix IS NULL);
