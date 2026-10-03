-- Index: idx_blockchain_audit_records_cognition_queued
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_blockchain_audit_records_cognition_queued ON public.blockchain_audit_records USING btree (status, record_type, created_at) WHERE ((record_type = 'aisha_cognition_anchor'::text) AND (status = 'queued'::text));
