-- Seed: ai_resolver_policy — the always-present GLOBAL default row.
--
-- Holds today's EXACT hardcoded resolver literals (from aisha_resolve_clow_backend)
-- so that wiring the resolver to READ this table (follow-up PR) is a byte-identical
-- no-op — provable by the orchestration-decision acceptance matrix
-- (aisha/db/tests/schema/12_orchestration_decision_matrix.sql / gate #18: same
-- top + candidates when policy == seed). Operators tune by editing this row or
-- adding scoped rows via set_ai_resolver_policy_audited (follow-up PR).
--
-- The GLOBAL row MUST always exist — the resolver fails LOUD on its absence (no
-- silent re-baked literal). Idempotent: the (global, NULL, NULL) row is unique.

INSERT INTO public.ai_resolver_policy
  (scope_type, scope_id, task_kind,
   bench_weight, local_bonus, cost_match_weight, tool_match_weight, vision_match_weight,
   budget_remaining_floor, budget_max_cost, premium_max_cost,
   batch_min_deadline_hours, batch_min_tokens, health_allow_set,
   default_bench, default_expected_tokens, default_deadline_hours,
   default_max_cost, default_budget_remaining)
VALUES
  ('global', NULL, NULL,
   0.55, 0.20, 0.15, 0.05, 0.05,         -- scoring weights
   1.00, 0.50, 5.00,                      -- cost-class boundaries (budget_remaining_floor, budget_max, premium_max)
   24, 50000, ARRAY['healthy','unknown'], -- batch thresholds + health allow-set
   0.5, 5000, 24,                         -- missing-data defaults (bench, expected_tokens, deadline_hours)
   1.00, 5.00)                            -- missing-data defaults (max_cost, budget_remaining)
ON CONFLICT ON CONSTRAINT ai_resolver_policy_scope_kind_uniq DO NOTHING;
