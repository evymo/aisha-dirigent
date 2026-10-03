-- Dev fixtures: a handful of neutral stories spread across kanban statuses so
-- Mission Control / Kanban have real rows in a fresh local dev/test stack.
-- FK-safe: partner_id / user_id / study_id are NULL (no demo-data dependency);
-- admin/staff see these via the admin-sees-all RLS path. Idempotent.

INSERT INTO public.partner_stories (
  id, partner_id, user_id, is_stack_default,
  title, status, priority, is_starred, default_branch, tech_stack,
  last_activity_at, created_at, updated_at
) VALUES
  (
    'de500000-0000-0000-0000-000000000001', NULL, NULL, false,
    'Dev: checkout flow refactor', 'in_progress', 'high', true,
    'feat/checkout-refactor', ARRAY['typescript','react','postgres'],
    now() - interval '2 hours', now() - interval '6 days', now() - interval '2 hours'
  ),
  (
    'de500000-0000-0000-0000-000000000002', NULL, NULL, false,
    'Dev: agent monitoring dashboard', 'in_review', 'normal', false,
    'feat/agent-monitoring', ARRAY['typescript','react'],
    now() - interval '1 day', now() - interval '9 days', now() - interval '1 day'
  ),
  (
    'de500000-0000-0000-0000-000000000003', NULL, NULL, false,
    'Dev: spend governance polish', 'inbox', 'normal', false,
    'feat/spend-governance', ARRAY['sql','typescript'],
    now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  priority = EXCLUDED.priority,
  is_starred = EXCLUDED.is_starred,
  default_branch = EXCLUDED.default_branch,
  tech_stack = EXCLUDED.tech_stack,
  updated_at = now();
