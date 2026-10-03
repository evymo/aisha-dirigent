-- Index: idx_model_benchmarks_model

CREATE INDEX idx_model_benchmarks_model ON public.ai_model_benchmarks USING btree (model_registry_id);
