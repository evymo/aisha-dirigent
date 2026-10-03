-- Index: idx_audit_logs_action
-- Table: audit_logs

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);
