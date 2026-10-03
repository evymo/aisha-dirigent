-- Index: idx_model_benchmarks_overall

CREATE INDEX idx_model_benchmarks_overall ON public.ai_model_benchmarks USING btree (overall_score DESC);
