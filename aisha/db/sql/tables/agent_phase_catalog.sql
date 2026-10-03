-- ============================================================================
-- Source of Truth: agent_phase_catalog
-- Purpose: Seed-extensible taxonomy of agent work phases. Replaces hardcoded
--          CHECK constraints / UI badge maps so AISHA can add phases by
--          inserting rows (self-tooling loop) instead of schema changes.
--          Two axes ship seeded:
--            activity — universal session state (idle, planning, tool_use,
--                       reviewing, stopped); validated by
--                       fn_upsert_agent_live_session.
--            pipeline — source-specific processing stage (routing, edge,
--                       backend, eval, streaming) used by the VS Code
--                       extension workPhase; stored in
--                       agent_live_sessions.phase_detail.
-- Managed by: seed aisha/db/seed/core/28_agent_phase_catalog.sql; reads via
--             get_agent_phase_catalog() for UI labels.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_phase_catalog (
  slug        text        NOT NULL,
  -- Axis is open text (not CHECK-constrained) — new axes are a seed concern.
  axis        text        NOT NULL DEFAULT 'activity',
  -- Locale-aware display labels: {cs, en, …} — same pattern as
  -- claude_hook_bindings.messages.
  labels      jsonb       NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (axis, slug),
  CONSTRAINT agent_phase_catalog_labels_has_locales
    CHECK (labels ? 'cs' AND labels ? 'en')
);

COMMENT ON TABLE public.agent_phase_catalog IS
  'Seed-extensible phase taxonomy for agent_live_sessions (axis=activity validated in RPC; axis=pipeline for source-specific detail). UI reads labels via get_agent_phase_catalog().';

ALTER TABLE public.agent_phase_catalog ENABLE ROW LEVEL SECURITY;
