-- Index: idx_ai_model_registry_provider_registry_id
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_ai_model_registry_provider_registry_id ON public.ai_model_registry USING btree (provider_registry_id);
