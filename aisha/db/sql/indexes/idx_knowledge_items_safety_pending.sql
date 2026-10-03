-- Index: idx_knowledge_items_safety_pending
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_knowledge_items_safety_pending ON public.knowledge_items USING btree (id) WHERE ((safety_scanned_at IS NULL) AND (status = 'active'::text));
