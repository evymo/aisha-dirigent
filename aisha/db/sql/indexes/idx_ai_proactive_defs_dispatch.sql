-- Index: idx_ai_proactive_defs_dispatch
-- Powers the per-row lookup in fn_dispatch_proactive_triggers (source_table + source_event,
-- active rules only) so the generic dispatch trigger adds negligible overhead to writes.

CREATE INDEX IF NOT EXISTS idx_ai_proactive_defs_dispatch
  ON public.ai_proactive_trigger_definitions USING btree (source_table, source_event)
  WHERE is_active;
