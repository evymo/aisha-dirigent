-- Index: idx_model_registry_admin_active
-- Auto-extracted (back-port reconciliation)

CREATE INDEX idx_model_registry_admin_active ON public.ai_model_registry USING btree (is_admin_active) WHERE (is_admin_active = true);
