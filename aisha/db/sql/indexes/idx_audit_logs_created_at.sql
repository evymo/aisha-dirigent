-- Index: idx_audit_logs_created_at
-- Table: audit_logs

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at);
