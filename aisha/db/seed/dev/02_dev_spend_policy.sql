-- Dev fixtures: a sensible global spend policy so the spend-governance surfaces
-- (Mission Control SpendPolicyCard, Appsmith dashboard, Dirigent view) show a
-- rule out of the box on a fresh dev/test stack. Catalog-band defaults still
-- apply to kinds without an explicit rule; this just demonstrates the matrix.
-- Idempotent against the (scope_type, scope_id, task_kind) unique key.

INSERT INTO public.ai_spend_policies (
  scope_type, scope_id, task_kind,
  auto_allow_under, ask_over, deny_over, is_active
) VALUES
  -- Global wildcard: ask above $5, hard-deny above $25 (dev-friendly headroom).
  ('global', NULL, NULL, 1.00, 5.00, 25.00, true),
  -- claude_cli_task: AISHA-spawned Claude CLI story-branch runs sit in the $8
  -- 'large' band, so allow under $10 to keep the dev spawn loop autonomous; ask
  -- above $10, hard-deny above $30. Operators retune this in Mission Control.
  ('global', NULL, 'claude_cli_task', 10.00, 10.00, 30.00, true)
ON CONFLICT (scope_type, scope_id, task_kind) DO UPDATE SET
  auto_allow_under = EXCLUDED.auto_allow_under,
  ask_over = EXCLUDED.ask_over,
  deny_over = EXCLUDED.deny_over,
  is_active = true,
  updated_at = now();
