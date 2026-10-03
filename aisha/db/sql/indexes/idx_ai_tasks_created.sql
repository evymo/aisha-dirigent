-- Index: idx_ai_tasks_created

CREATE INDEX idx_ai_tasks_created ON public.ai_tasks USING btree (created_at DESC);
