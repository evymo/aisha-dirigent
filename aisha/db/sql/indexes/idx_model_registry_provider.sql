-- Index: idx_model_registry_provider

CREATE INDEX idx_model_registry_provider ON public.ai_model_registry USING btree (provider);
