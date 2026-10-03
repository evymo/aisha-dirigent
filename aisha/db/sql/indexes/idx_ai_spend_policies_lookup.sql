-- Index: idx_ai_spend_policies_lookup
-- Most-specific-active-policy lookup (scope_type, scope_id, task_kind).

CREATE INDEX IF NOT EXISTS idx_ai_spend_policies_lookup
  ON public.ai_spend_policies (scope_type, scope_id, task_kind)
  WHERE is_active = true;
