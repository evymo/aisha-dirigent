-- Index: idx_member_health_documents_quarantine
-- Mirrors idx_knowledge_items_quarantine — a partial index over the blocked AV states so
-- the quarantine review queue (and the fail-closed serving/vectorization gates) stay cheap.

CREATE INDEX IF NOT EXISTS idx_member_health_documents_quarantine
  ON public.member_health_documents USING btree (quarantine_status)
  WHERE (quarantine_status = ANY (ARRAY['flagged'::text, 'quarantined'::text]));
