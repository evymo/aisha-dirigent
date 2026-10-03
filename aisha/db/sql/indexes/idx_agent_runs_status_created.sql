-- Index: idx_agent_runs_status_created

CREATE INDEX idx_agent_runs_status_created ON public.agent_runs USING btree (status, created_at);
