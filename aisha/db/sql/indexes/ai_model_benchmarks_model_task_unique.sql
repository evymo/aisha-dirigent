-- Index: ai_model_benchmarks_model_task_unique

CREATE UNIQUE INDEX ai_model_benchmarks_model_task_unique ON public.ai_model_benchmarks USING btree (model_registry_id, task_type, eval_run_id);
