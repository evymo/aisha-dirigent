-- ==============================================================================
-- Workflow + delivery status lookups — canonical seed (core layer)
-- ==============================================================================
-- The mission-control kanban derives its swimlanes from workflow_statuses and
-- update_story_status_audited validates transitions against
-- workflow_status_transitions; delivery governance reads delivery_statuses
-- (requires_approval / restricts_actions flags consumed by svc-ai-chat
-- governedOrchestration). The tables are part of the generated baseline, but
-- their ROWS lived only in the absorbed migration (now in the baseline)* foundation deltas —
-- absorbed schema-only into the 0.9.0 baseline, which left every fresh install
-- with empty lookups: the kanban renders zero columns and EVERY status
-- transition is rejected ("no transition row = illegal"), exactly what the
-- 2026-06 stack audit found in production.
--
-- Seed rows belong in the seed layer under the wipe-first baseline-only
-- release policy (baseline = schema from aisha/db/sql; data = aisha/db/seed).
-- Idempotent: INSERT ... ON CONFLICT DO UPDATE (re-runnable on warmup).
-- Source: the absorbed migration (now in the baseline)
--         the absorbed migration (now in the baseline)
-- ==============================================================================

-- ── workflow_statuses + workflow_status_transitions ──────────────────────────

INSERT INTO public.workflow_statuses
  (status,        label_i18n_key,                  sort_order, swimlane_color, is_terminal, notes)
VALUES
  ('inbox',       'storyloop.statuses.inbox',       1, 'slate',  false,
    'Default landing status for new stories. Triaged from here.'),
  ('in_progress', 'storyloop.statuses.inProgress',  2, 'blue',   false,
    'Story is being actively worked on by an agent or human collaborator.'),
  ('scheduled',   'storyloop.statuses.scheduled',   3, 'amber',  false,
    'Story is paused awaiting a scheduled time, dependency, or external input.'),
  ('active',      'storyloop.statuses.active',      4, 'emerald', false,
    'General active state used by partner stories outside the in_progress / scheduled split.'),
  ('archived',    'storyloop.statuses.archived',    5, 'zinc',   true,
    'Story is complete and archived. De-archive requires admin/staff role.'),
  ('trash',       'storyloop.statuses.trash',       6, 'rose',   true,
    'Story has been soft-deleted. Restore requires admin/staff role.')
ON CONFLICT (status) DO UPDATE SET
  label_i18n_key = EXCLUDED.label_i18n_key,
  sort_order     = EXCLUDED.sort_order,
  swimlane_color = EXCLUDED.swimlane_color,
  is_terminal    = EXCLUDED.is_terminal,
  notes          = EXCLUDED.notes,
  updated_at     = now();

INSERT INTO public.workflow_status_transitions
  (from_status,   to_status,    requires_role, notes)
VALUES
  -- From inbox
  ('inbox',       'in_progress', NULL, 'Triage: pick up story for active work.'),
  ('inbox',       'scheduled',   NULL, 'Triage: defer to scheduled time.'),
  ('inbox',       'active',      NULL, 'Triage: park as active partner story.'),
  ('inbox',       'archived',    NULL, 'Triage: archive without work.'),
  ('inbox',       'trash',       NULL, 'Triage: discard.'),

  -- From in_progress
  ('in_progress', 'inbox',       NULL, 'Reset to triage.'),
  ('in_progress', 'scheduled',   NULL, 'Pause work, schedule for later.'),
  ('in_progress', 'active',      NULL, 'Move to general active state.'),
  ('in_progress', 'archived',    NULL, 'Complete and archive.'),
  ('in_progress', 'trash',       NULL, 'Discard during work.'),

  -- From scheduled
  ('scheduled',   'inbox',       NULL, 'Cancel schedule, return to triage.'),
  ('scheduled',   'in_progress', NULL, 'Schedule reached, begin work.'),
  ('scheduled',   'active',      NULL, 'Move to general active state.'),
  ('scheduled',   'archived',    NULL, 'Cancel and archive.'),
  ('scheduled',   'trash',       NULL, 'Cancel and discard.'),

  -- From active
  ('active',      'inbox',       NULL, 'Re-triage.'),
  ('active',      'in_progress', NULL, 'Promote to in-progress.'),
  ('active',      'scheduled',   NULL, 'Schedule for later.'),
  ('active',      'archived',    NULL, 'Complete and archive.'),
  ('active',      'trash',       NULL, 'Discard.'),

  -- From archived (admin gated)
  ('archived',    'inbox',       'admin',
    'Re-open archived story. Admin/staff only — surfaces the story back into triage.'),

  -- From trash (admin gated)
  ('trash',       'inbox',       'admin',
    'Restore from trash. Admin/staff only — surfaces the story back into triage.')
ON CONFLICT (from_status, to_status) DO UPDATE SET
  requires_role = EXCLUDED.requires_role,
  notes         = EXCLUDED.notes,
  updated_at    = now();

-- ── delivery_statuses ─────────────────────────────────────────────────────────

INSERT INTO public.delivery_statuses
  (status,       label_i18n_key,                          sort_order, swimlane_color,
   requires_approval, restricts_actions, is_terminal, notes)
VALUES
  ('draft',      'storyloop.deliveryStatuses.draft',       1, 'slate',
    false, false, false,
    'Initial draft — no governance restrictions.'),
  ('in_review',  'storyloop.deliveryStatuses.inReview',    2, 'blue',
    false, false, false,
    'Under review by partner/admin — no governance restrictions yet.'),
  ('ready',      'storyloop.deliveryStatuses.ready',       3, 'cyan',
    false, false, false,
    'Approved for delivery — no governance restrictions.'),
  ('qa',         'storyloop.deliveryStatuses.qa',          4, 'amber',
    false, true,  false,
    'QA in progress — tool execution restricted to avoid disturbing test runs.'),
  ('delivering', 'storyloop.deliveryStatuses.delivering',  5, 'orange',
    true,  true,  false,
    'Active delivery — admin approval + restricted actions while shipping.'),
  ('delivered',  'storyloop.deliveryStatuses.delivered',   6, 'emerald',
    true,  true,  true,
    'Delivered — terminal state with admin approval gate and restricted actions.'),
  ('archived',   'storyloop.deliveryStatuses.archived',    7, 'zinc',
    true,  false, true,
    'Archived — admin approval gate; actions unrestricted (read-only review allowed).')
ON CONFLICT (status) DO UPDATE SET
  label_i18n_key    = EXCLUDED.label_i18n_key,
  sort_order        = EXCLUDED.sort_order,
  swimlane_color    = EXCLUDED.swimlane_color,
  requires_approval = EXCLUDED.requires_approval,
  restricts_actions = EXCLUDED.restricts_actions,
  is_terminal       = EXCLUDED.is_terminal,
  notes             = EXCLUDED.notes,
  updated_at        = now();
