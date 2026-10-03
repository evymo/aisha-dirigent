-- Index: idx_instance_auth_tokens_instance
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_instance_auth_tokens_instance ON public.instance_auth_tokens USING btree (instance_id);
