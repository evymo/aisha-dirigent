-- Index: idx_ai_eval_runs_agent

CREATE INDEX idx_ai_eval_runs_agent ON public.ai_eval_runs USING btree (agent_config_id);
