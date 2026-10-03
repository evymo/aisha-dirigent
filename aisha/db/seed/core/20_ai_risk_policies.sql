-- ============================================================================
-- Core seed: ai_risk_policies — global risk-threshold tuple (E0 governance)
-- ============================================================================
-- GOVERNANCE = POLICY (thresholds), NOT a list. This file seeds ONE global
-- threshold row that maps a clow's COMPUTED risk level (low|medium|high|
-- critical — same vocabulary as drift_state.risk_level / ai_decisions.risk_level)
-- onto an allow / ask / deny verdict:
--
--     computed risk <= auto_allow_at_or_below  → allow (silent)
--     computed risk >  ask_above               → ask   (Mission Control HITL)
--     computed risk >  deny_above              → deny  (hard ceiling)
--
-- With the defaults below (allow@low, ask>medium, deny>critical):
--     low      → allow      medium → allow (== ask_above boundary)
--     high     → ask        critical → ask (deny_above=critical never trips)
-- i.e. the global posture asks above medium and never hard-denies on risk
-- alone; operators tighten deny_above per high-risk story/task_kind. The
-- human-approval gate is triggered by THIS computed risk crossing a threshold,
-- never by membership in a maintained allow-list of "approved" entities.
--
-- This mirrors ai_spend_policies (the spend half of admission): a threshold
-- tuple resolved most-specific-row-wins, NOT an allow-list of permitted names.
-- A single value per threshold lives in a column — that is policy, not a list.
--
-- Schema (table + scope/threshold CHECKs + the
-- (scope_type, scope_id, task_kind) unique key) lives in canonical SoT at
-- aisha/db/sql/tables/ai_risk_policies.sql. This file is DATA only (mirrors
-- the SoT separation of 18_governance_flags.sql / 19_ai_provider_catalog.sql).
--
-- Idempotent: ON CONFLICT (scope_type, scope_id, task_kind) DO UPDATE refreshes
-- the thresholds in place so a re-seed re-asserts the global baseline without
-- duplicating the wildcard row. Per-story/partner/task_kind overrides layer on
-- top via the audited policy setter and are left untouched by this re-seed.
-- ============================================================================

INSERT INTO public.ai_risk_policies (
  scope_type, scope_id, task_kind,
  auto_allow_at_or_below, ask_above, deny_above
) VALUES
  -- Global wildcard (scope_id NULL, task_kind NULL): the zero-config baseline
  -- every clow falls back to when no more-specific risk policy matches.
  ('global', NULL, NULL, 'low', 'medium', 'critical')
ON CONFLICT (scope_type, scope_id, task_kind) DO UPDATE SET
  auto_allow_at_or_below = EXCLUDED.auto_allow_at_or_below,
  ask_above              = EXCLUDED.ask_above,
  deny_above             = EXCLUDED.deny_above,
  updated_at             = now();
