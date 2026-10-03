-- Index: idx_model_benchmarks_task

CREATE INDEX idx_model_benchmarks_task ON public.ai_model_benchmarks USING btree (task_type);
