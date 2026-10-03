-- Index: idx_critic_iter_run

CREATE INDEX IF NOT EXISTS idx_critic_iter_run ON public.ai_run_critic_iterations USING btree (ai_run_id, iteration);
