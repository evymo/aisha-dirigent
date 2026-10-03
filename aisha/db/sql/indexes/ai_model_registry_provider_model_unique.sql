-- Index: ai_model_registry_provider_model_unique
--
-- The seed's ai_model_registry ON CONFLICT (provider, model_id) arbiter. Re-applied
-- by heals for existing DBs (the registry heal), so IF NOT EXISTS — idempotent on
-- every migrate.

CREATE UNIQUE INDEX IF NOT EXISTS ai_model_registry_provider_model_unique ON public.ai_model_registry USING btree (provider, model_id);
