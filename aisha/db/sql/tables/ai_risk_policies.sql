-- ============================================================================
-- Source of Truth: ai_risk_policies
-- Purpose: User-set RISK authorization thresholds — the governance-as-policy
--          mechanism deciding whether a clow of a given computed risk_level may
--          dispatch. Risk is COMPUTED from the clow (criticality, side-effect
--          class) into an ordinal band (low < medium < high < critical); the
--          chosen band is compared against this scope's threshold tuple:
--            computed risk <= auto_allow_at_or_below → allow (silent)
--            computed risk >  ask_above              → ask (blocked + human
--                                                       approval triggered BY
--                                                       RISK, not by membership)
--            computed risk >  deny_above             → deny (hard policy ceiling)
--          Resolution mirrors ai_spend_policies — most specific active row wins:
--            (scope story, kind) > (scope story, *) > (global, kind) > (global, *)
--          No row matched → conservative built-in default band (NOT a stored
--          list). This is a THRESHOLD TUPLE per scope, never a roster of
--          permitted names: the clow governs itself via its own computed risk;
--          the policy only sets where the allow/ask/deny boundaries fall.
-- Managed by: set_ai_risk_policy_audited() (admin/staff); read by the admission
--             composer / risk evaluator and the Mission Control policy card.
-- Mirrors the shape of ai_spend_policies (USD bands → ordinal risk bands).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_risk_policies (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'global' (scope_id NULL) | 'story' | 'partner'
  scope_type            text        NOT NULL DEFAULT 'global',
  scope_id              uuid,
  -- NULL = applies to all kinds within the scope ('*' wildcard row)
  task_kind             text,
  -- Ordinal risk bands (low < medium < high < critical). Each column is a
  -- SINGLE threshold value (rather than a list of permitted things).
  auto_allow_at_or_below text       CHECK (auto_allow_at_or_below IS NULL OR auto_allow_at_or_below IN ('low', 'medium', 'high', 'critical')),
  ask_above             text        CHECK (ask_above IS NULL OR ask_above IN ('low', 'medium', 'high', 'critical')),
  deny_above            text        CHECK (deny_above IS NULL OR deny_above IN ('low', 'medium', 'high', 'critical')),
  is_active             boolean     NOT NULL DEFAULT true,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- scope_type: global + story are the ENFORCED axes (read by fn_admit_clow's risk-policy
  -- resolution, most-specific-wins). partner is a RESERVED forward-looking seam — accepted by
  -- the CHECK so a partner risk policy can be authored ahead of reader wiring, but no enforcer
  -- reads it yet and nothing writes it → INTENTIONALLY non-binding (a recorded seam, NOT a
  -- fail-open). The scope-type-write-read-parity gate catches a future CHECK scope that is
  -- neither enforced nor reserved-here. @scope-reserved: partner
  CONSTRAINT ai_risk_policies_scope_check
    CHECK (scope_type IN ('global', 'story', 'partner')),
  CONSTRAINT ai_risk_policies_scope_id_presence
    CHECK ((scope_type = 'global') = (scope_id IS NULL)),
  -- Threshold coherence on the ordinal band (mirrors ai_spend_policies order
  -- invariant): allow boundary <= ask boundary <= deny boundary. The rank
  -- expression is an inline ordinal map (rather than a maintained allow-list).
  CONSTRAINT ai_risk_policies_threshold_order
    CHECK (
      (auto_allow_at_or_below IS NULL OR ask_above IS NULL
        OR CASE auto_allow_at_or_below
             WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END
           <= CASE ask_above
             WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END)
      AND (ask_above IS NULL OR deny_above IS NULL
        OR CASE ask_above
             WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END
           <= CASE deny_above
             WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END)
    ),
  CONSTRAINT ai_risk_policies_scope_kind_uniq
    UNIQUE NULLS NOT DISTINCT (scope_type, scope_id, task_kind)
);

COMMENT ON TABLE public.ai_risk_policies IS
  'User-set allow/ask/deny risk-band thresholds per scope x task-kind. Risk is computed per clow and compared to this tuple; most specific active row wins. A threshold tuple, NOT a list of permitted entities.';

-- Index lives in aisha/db/sql/indexes/idx_ai_risk_policies_lookup.sql (SoT separation).
-- RLS policies live in aisha/db/sql/rls/ai_risk_policies.sql (emitted AFTER
-- functions in the baseline so is_admin_or_staff/auth.role exist when they bind).

ALTER TABLE public.ai_risk_policies ENABLE ROW LEVEL SECURITY;
