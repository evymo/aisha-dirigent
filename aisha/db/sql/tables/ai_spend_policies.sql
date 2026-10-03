-- ============================================================================
-- Source of Truth: ai_spend_policies
-- Purpose: User-set spend authorization thresholds — the simple user-driven
--          mechanism deciding whether a task of a given kind may start:
--            estimated p90 <  auto_allow_under → allow (silent)
--            estimated p90 >= ask_over         → ask (blocked run +
--                                                    Mission Control approval)
--            estimated p90 >= deny_over        → deny (hard policy ceiling)
--          Resolution: most specific active row wins —
--            (scope story, kind) > (scope story, *) > (global, kind) > (global, *)
--          No row matched → defaults derived from ai_cost_class_catalog
--          (allow under class p90, ask above it, deny above 3×p90).
-- Managed by: set_ai_spend_policy_audited() (admin/staff); read by
--             fn_authorize_task_spend() and the Mission Control policy card.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_spend_policies (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'global' (scope_id NULL) | 'story' | 'partner'
  scope_type           text        NOT NULL DEFAULT 'global',
  scope_id             uuid,
  -- NULL = applies to all kinds within the scope ('*' wildcard row)
  task_kind            text,
  auto_allow_under numeric(10,4),
  ask_over         numeric(10,4),
  deny_over        numeric(10,4),
  is_active            boolean     NOT NULL DEFAULT true,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- scope_type: global + story are the ENFORCED axes (read by fn_authorize_task_spend, most-
  -- specific-wins). partner is a RESERVED forward-looking seam — accepted by the CHECK so a
  -- partner policy can be authored ahead of reader wiring, but no enforcer reads it yet and
  -- nothing writes it → INTENTIONALLY non-binding (a recorded seam, NOT a fail-open). The
  -- scope-type-write-read-parity gate keeps this honest: a future CHECK scope that is neither
  -- enforced nor reserved-here fails the gate. @scope-reserved: partner
  CONSTRAINT ai_spend_policies_scope_check
    CHECK (scope_type IN ('global', 'story', 'partner')),
  CONSTRAINT ai_spend_policies_scope_id_presence
    CHECK ((scope_type = 'global') = (scope_id IS NULL)),
  CONSTRAINT ai_spend_policies_threshold_order
    CHECK (
      (auto_allow_under IS NULL OR ask_over IS NULL
        OR auto_allow_under <= ask_over)
      AND (ask_over IS NULL OR deny_over IS NULL
        OR ask_over <= deny_over)
    ),
  CONSTRAINT ai_spend_policies_scope_kind_uniq
    UNIQUE NULLS NOT DISTINCT (scope_type, scope_id, task_kind)
);

COMMENT ON TABLE public.ai_spend_policies IS
  'User-set allow/ask/deny USD thresholds per scope×task-kind. Most specific active row wins; catalog bands are the zero-config fallback.';

-- Index lives in aisha/db/sql/indexes/idx_ai_spend_policies_lookup.sql (SoT separation).

ALTER TABLE public.ai_spend_policies ENABLE ROW LEVEL SECURITY;
