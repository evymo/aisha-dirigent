-- ============================================================================
-- Source of Truth: ai_resolver_policy
-- Purpose: Operator-tunable weights + thresholds for the orchestration-decision
--          resolver (public.aisha_resolve_clow_backend). Until this table, the
--          decision FUNCTION was 100% hardcoded literals (scoring weights, cost-
--          class cutoffs, batch thresholds, health allow-set, missing-data
--          defaults) — the candidate SET was registry-dynamic but the decision
--          POLICY could not be tuned without a code change. This is the single
--          operator-facing SoT for that policy: one seeded GLOBAL row carrying
--          today's exact literals, editable per scope×task-kind.
--          Resolution (most specific active row wins, like ai_spend_policies):
--            (story|instance, kind) > (story|instance, *) > (global, kind) > (global, *)
--          The GLOBAL row is the platform default and MUST always exist — the
--          resolver fails LOUD on its absence (no silent re-baked literal).
-- Read by:   public.aisha_resolve_clow_backend (wired in the follow-up PR; this
--            PR ships the substrate + seed with NO behaviour change).
-- Managed by: set_ai_resolver_policy_audited() (admin/staff) — follow-up PR.
-- @scope-reserved: story, instance
--   global is the platform-wide policy axis read by the resolver. story + instance
--   are forward-looking seams (per-context / per-instance weight overrides) —
--   accepted by the CHECK so a scoped policy can be authored ahead of reader
--   wiring, but INTENTIONALLY non-binding until the resolver reads them. Kept
--   honest by the scope-type-write-read-parity gate.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_resolver_policy (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'global' (scope_id NULL) | 'story' | 'instance'
  scope_type                   text        NOT NULL DEFAULT 'global',
  scope_id                     uuid,
  -- NULL = applies to all task kinds within the scope ('*' wildcard row)
  task_kind                    text,

  -- Scoring weights — applied to each candidate's score in aisha_resolve_clow_backend:
  --   score = bench*bench_weight + local_bonus + cost_match_weight + tool/vision weights
  bench_weight                 numeric(6,4) NOT NULL DEFAULT 0.55,
  local_bonus                  numeric(6,4) NOT NULL DEFAULT 0.20,
  cost_match_weight            numeric(6,4) NOT NULL DEFAULT 0.15,
  tool_match_weight            numeric(6,4) NOT NULL DEFAULT 0.05,
  vision_match_weight          numeric(6,4) NOT NULL DEFAULT 0.05,

  -- Cost-class boundaries (USD): budget when budget_remaining < floor OR max_cost < budget_max;
  -- premium when max_cost > premium_max; else standard.
  budget_remaining_floor   numeric(10,4) NOT NULL DEFAULT 1.00,
  budget_max_cost          numeric(10,4) NOT NULL DEFAULT 0.50,
  premium_max_cost         numeric(10,4) NOT NULL DEFAULT 5.00,

  -- Batch eligibility thresholds.
  batch_min_deadline_hours     integer     NOT NULL DEFAULT 24,
  batch_min_tokens             integer     NOT NULL DEFAULT 50000,

  -- Health states a provider may be in to remain eligible.
  health_allow_set             text[]      NOT NULL DEFAULT ARRAY['healthy','unknown'],

  -- Missing-data defaults the resolver COALESCEs to when a caller omits an input.
  default_bench                numeric(6,4) NOT NULL DEFAULT 0.5,
  default_expected_tokens      integer     NOT NULL DEFAULT 5000,
  default_deadline_hours       integer     NOT NULL DEFAULT 24,
  default_max_cost         numeric(10,4) NOT NULL DEFAULT 1.00,
  default_budget_remaining numeric(10,4) NOT NULL DEFAULT 5.00,

  is_active                    boolean     NOT NULL DEFAULT true,
  created_by                   uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_resolver_policy_scope_check
    CHECK (scope_type IN ('global', 'story', 'instance')),
  CONSTRAINT ai_resolver_policy_scope_id_presence
    CHECK ((scope_type = 'global') = (scope_id IS NULL)),
  -- Weights are non-negative (a negative weight would invert ranking semantics).
  CONSTRAINT ai_resolver_policy_weights_nonneg
    CHECK (bench_weight >= 0 AND local_bonus >= 0 AND cost_match_weight >= 0
           AND tool_match_weight >= 0 AND vision_match_weight >= 0),
  -- Cost-class boundaries must be ordered (budget cutoff <= premium cutoff).
  CONSTRAINT ai_resolver_policy_cost_order
    CHECK (budget_max_cost <= premium_max_cost),
  -- Positive operational thresholds.
  CONSTRAINT ai_resolver_policy_thresholds_pos
    CHECK (batch_min_deadline_hours > 0 AND batch_min_tokens > 0
           AND default_expected_tokens > 0 AND default_deadline_hours > 0),
  -- Health allow-set must be non-empty (an empty set would exclude every provider).
  CONSTRAINT ai_resolver_policy_health_nonempty
    CHECK (cardinality(health_allow_set) > 0),
  CONSTRAINT ai_resolver_policy_scope_kind_uniq
    UNIQUE NULLS NOT DISTINCT (scope_type, scope_id, task_kind)
);

COMMENT ON TABLE public.ai_resolver_policy IS
  'Operator-tunable weights/thresholds for aisha_resolve_clow_backend. Most specific active row wins; the GLOBAL row is the always-present platform default (resolver fails loud if absent).';

-- Index lives in aisha/db/sql/indexes/idx_ai_resolver_policy_lookup.sql (SoT separation).
-- RLS lives in aisha/db/sql/rls/ai_resolver_policy.sql (emitted after functions).
-- updated_at trigger lives in aisha/db/sql/triggers/ai_resolver_policy_updated_at.sql.

ALTER TABLE public.ai_resolver_policy ENABLE ROW LEVEL SECURITY;
