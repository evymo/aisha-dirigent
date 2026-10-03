-- Index: idx_critic_iter_decision

CREATE INDEX IF NOT EXISTS idx_critic_iter_decision ON public.ai_run_critic_iterations USING btree (decision, created_at DESC);
