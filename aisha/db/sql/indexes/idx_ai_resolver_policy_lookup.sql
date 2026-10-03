-- Index: idx_ai_resolver_policy_lookup
-- Most-specific-active-policy lookup (scope_type, scope_id, task_kind).

CREATE INDEX IF NOT EXISTS idx_ai_resolver_policy_lookup
  ON public.ai_resolver_policy (scope_type, scope_id, task_kind)
  WHERE is_active = true;
