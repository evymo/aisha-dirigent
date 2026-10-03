-- Index: idx_ai_proactive_runs_cooldown
-- Powers the cooldown EXISTS check in fn_dispatch_proactive_triggers
-- (trigger_definition_id + source_record_id, most-recent-first).

CREATE INDEX IF NOT EXISTS idx_ai_proactive_runs_cooldown
  ON public.ai_proactive_runs USING btree (trigger_definition_id, source_record_id, created_at DESC);
