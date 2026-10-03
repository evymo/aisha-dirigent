-- Table: delivery_statuses
-- Lookup table for partner_stories.delivery_status pipeline (parallel to
-- workflow_statuses on the kanban side). Exposes per-status policy flags
-- that previously lived as hardcoded TS Sets in
-- services/svc-ai-chat/src/lib/governedOrchestration.ts:272-283.
--
-- Two key flags, both consumed by the governed orchestration layer:
--   requires_approval  — actions on a story in this status require admin
--                        approval (currently delivering / delivered / archived)
--   restricts_actions  — tool execution is restricted while a story is in
--                        this status (currently qa / delivering / delivered)
--
-- Pipeline transitions themselves live in delivery_transition_rules. This
-- table is per-status metadata; the two are complementary.

CREATE TABLE IF NOT EXISTS public.delivery_statuses (
  -- Stable identifier referenced by partner_stories.delivery_status.
  status text PRIMARY KEY,

  -- i18n key path for the display label, e.g.
  -- 'storyloop.deliveryStatuses.delivering'.
  label_i18n_key text NOT NULL,

  -- Pipeline order (ASC). Lower = earlier in the lifecycle.
  sort_order int NOT NULL DEFAULT 0,

  -- Optional UI hint (Tailwind class name or hex color).
  swimlane_color text,

  -- Governance flag: actions on stories in this status require admin
  -- approval (mirrors APPROVAL_REQUIRED_STATUSES Set).
  requires_approval boolean NOT NULL DEFAULT false,

  -- Governance flag: tool execution is restricted while in this status
  -- (mirrors RESTRICTED_ACTION_STATUSES Set).
  restricts_actions boolean NOT NULL DEFAULT false,

  -- Terminal statuses are end-of-pipeline.
  is_terminal boolean NOT NULL DEFAULT false,

  -- Soft-disable a status without dropping the row.
  is_active boolean NOT NULL DEFAULT true,

  -- Operator notes — surfaces in admin status manager.
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_statuses ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.delivery_statuses IS
  'Source-of-truth for partner_stories.delivery_status pipeline metadata. Exposes per-status governance flags (requires_approval, restricts_actions) previously hardcoded in governedOrchestration.ts. Parallel to workflow_statuses (kanban side); transition graph in delivery_transition_rules.';

-- Indexes live in aisha/db/sql/indexes/idx_delivery_statuses_active_order.sql
-- per SQL Source Separation rule.
