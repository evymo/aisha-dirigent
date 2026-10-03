-- Index: idx_audit_logs_user_id
-- Table: audit_logs

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);
