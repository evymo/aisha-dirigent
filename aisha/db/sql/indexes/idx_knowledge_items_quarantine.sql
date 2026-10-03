-- Index: idx_knowledge_items_quarantine
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_knowledge_items_quarantine ON public.knowledge_items USING btree (quarantine_status) WHERE (quarantine_status = ANY (ARRAY['flagged'::text, 'quarantined'::text]));
