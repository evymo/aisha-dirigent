-- Table: workflow_statuses
-- Lookup table for kanban lifecycle statuses on partner_stories.status.
-- Drives kanban swimlanes, i18n labels, sort order, and DB-level validation
-- in update_story_status_audited.
--
-- This is the source-of-truth that replaces the hardcoded list previously
-- duplicated in three places:
--   - update_story_status_audited.sql IN-clause validator
--   - get_storyloop_admin_overview.sql COUNT FILTER predicates
--   - frontend storyloop.<status> i18n key references
--
-- See also: delivery_transition_rules + delivery_transitions (the parallel
-- lookup system that governs partner_stories.delivery_status — a separate
-- pipeline status orthogonal to kanban lifecycle).

CREATE TABLE IF NOT EXISTS public.workflow_statuses (
  -- Stable identifier referenced by partner_stories.status FK.
  status text PRIMARY KEY,

  -- i18n key path that resolves to the display label, e.g.
  -- 'storyloop.statuses.inbox'. UI must call t(label_i18n_key) — never
  -- render the raw `status` column.
  label_i18n_key text NOT NULL,

  -- Kanban column ordering (ASC). Lower = leftmost.
  sort_order int NOT NULL DEFAULT 0,

  -- Optional UI hint (Tailwind class name or hex color) used by kanban
  -- swimlane headers. NULL means "use default theme".
  swimlane_color text,

  -- Terminal statuses are end-of-pipeline (e.g. 'archived', 'trash').
  -- Kanban renders them collapsed by default.
  is_terminal boolean NOT NULL DEFAULT false,

  -- Soft-disable a status without dropping the row (FK references stay
  -- valid). UI hides inactive statuses for new transitions.
  is_active boolean NOT NULL DEFAULT true,

  -- Operator notes — surfaces in admin status manager.
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_statuses ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.workflow_statuses IS
  'Source-of-truth for partner_stories.status kanban lifecycle. Drives swimlane labels, sort order, and update_story_status_audited validation. Parallel to delivery_transition_rules (delivery_status side).';

-- Indexes live in aisha/db/sql/indexes/idx_workflow_statuses_active_order.sql
-- per SQL Source Separation rule.
