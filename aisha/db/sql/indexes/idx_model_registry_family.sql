-- Index: idx_model_registry_family

CREATE INDEX idx_model_registry_family ON public.ai_model_registry USING btree (model_family);
