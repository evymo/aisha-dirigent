-- Index: idx_ai_risk_policies_lookup
-- Most-specific-active-risk-policy lookup (scope_type, scope_id, task_kind).
-- Mirrors idx_ai_spend_policies_lookup: the risk evaluator resolves the
-- governing policy by walking scope precedence and filters to active rows.
-- Governance is POLICY (threshold/risk), not an allow-list — each row
-- self-governs via its own is_active flag.

CREATE INDEX IF NOT EXISTS idx_ai_risk_policies_lookup
  ON public.ai_risk_policies (scope_type, scope_id, task_kind)
  WHERE is_active;
