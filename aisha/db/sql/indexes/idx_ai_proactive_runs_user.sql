-- Index: idx_ai_proactive_runs_user

CREATE INDEX idx_ai_proactive_runs_user ON public.ai_proactive_runs USING btree (user_id);
