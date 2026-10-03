-- Index: idx_model_registry_available

CREATE INDEX idx_model_registry_available ON public.ai_model_registry USING btree (is_available, provider);
