-- Index: idx_ai_tasks_status

CREATE INDEX idx_ai_tasks_status ON public.ai_tasks USING btree (status) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));
