-- ==============================================================================
-- Plugin control-plane state machine — canonical seed (core layer)
-- ==============================================================================
-- transition_plugin_status validates every plugin lifecycle move against
-- plugin_transition_rules (from_status, to_status) → requires_role. The table is
-- part of the generated baseline, but its ROWS lived only in
-- the absorbed migration (now in the baseline) (absorbed
-- schema-only into the 0.9.0 baseline), which left every fresh install with an
-- EMPTY rule set: transition_plugin_status then returns "Transition X → Y not
-- allowed" for everything, so there is no admin kill-switch (ga/canary →
-- disabled, → archived) for a live plugin. Same bug class as the workflow/
-- delivery lookups in 16_workflow_status_lookups.sql.
--
-- This matters for the agent marketplace: certified-member agents reach
-- 'canary'/'ga' (listing-visible, installable), and an operator must be able to
-- pull one. Seeding these rows makes the kill-switch real on cold-start.
--
-- Idempotent: ON CONFLICT (from_status, to_status) DO NOTHING.
-- ==============================================================================

INSERT INTO public.plugin_transition_rules (from_status, to_status, requires_role, description) VALUES
  ('submitted',       'reviewing',       'staff',  'Staff begins review'),
  ('submitted',       'disabled',        'staff',  'Reject on submission'),
  ('reviewing',       'sandbox_testing', 'staff',  'Advance to sandbox test'),
  ('reviewing',       'disabled',        'staff',  'Reject during review'),
  ('sandbox_testing', 'approved',        NULL,     'Auto-approve after sandbox pass'),
  ('sandbox_testing', 'disabled',        NULL,     'Auto-disable on sandbox failure'),
  ('approved',        'canary',          'staff',  'Deploy to canary'),
  ('approved',        'disabled',        'staff',  'Disable approved plugin'),
  ('canary',          'ga',              NULL,     'Promote to GA after health check'),
  ('canary',          'disabled',        NULL,     'Auto-rollback on canary failure'),
  ('ga',              'disabled',        'staff',  'Kill-switch'),
  ('ga',              'archived',        'admin',  'Archive GA plugin'),
  ('disabled',        'reviewing',       'staff',  'Re-review disabled plugin'),
  ('disabled',        'archived',        'admin',  'Archive disabled plugin'),
  ('archived',        'reviewing',       'admin',  'Unarchive for re-review')
ON CONFLICT (from_status, to_status) DO NOTHING;
