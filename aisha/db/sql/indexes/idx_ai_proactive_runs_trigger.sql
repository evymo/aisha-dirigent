-- Index: idx_ai_proactive_runs_trigger

CREATE INDEX idx_ai_proactive_runs_trigger ON public.ai_proactive_runs USING btree (trigger_definition_id);
