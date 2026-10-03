-- Index: ai_scheduled_jobs_name_key

CREATE UNIQUE INDEX ai_scheduled_jobs_name_key ON public.ai_scheduled_jobs USING btree (name);
