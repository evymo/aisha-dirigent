-- Index: idx_ai_tasks_user

CREATE INDEX idx_ai_tasks_user ON public.ai_tasks USING btree (user_id);
