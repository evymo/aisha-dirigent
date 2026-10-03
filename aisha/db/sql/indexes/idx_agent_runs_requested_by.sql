-- Index: idx_agent_runs_requested_by

CREATE INDEX idx_agent_runs_requested_by ON public.agent_runs USING btree (requested_by, created_at DESC);
