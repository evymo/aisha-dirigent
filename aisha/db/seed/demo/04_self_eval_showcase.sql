-- =============================================================================
-- Demo seed 04 — Self-Eval Showcase (platform self-monitoring fixture)
-- =============================================================================
-- Seeds two synthetic platform-ops stories with signals across every table the
-- story self-evaluation LENS reads, so functional tests
-- (src/tests/db/self-eval-rpc-runtime.test.ts) can assert evaluate_story_self,
-- get_story_aisha_maturity, the verdict view and the proposal-outcome loop
-- against a clean, fully-seeded stack.
--
-- These are NOT user content — they are an ops/self-monitoring SHOWCASE of the
-- AISHA self-eval capability. Every row is idempotent (ON CONFLICT DO NOTHING)
-- and time-relative to now() so the 30-day rolling windows always include them.
-- agent_slug='dirigent' resolves against core/20_aisha_backbone.sql (system seed,
-- runs before demo); no agent data is duplicated here.
--
--   Story A (healthy)    — webhooks ok, deploy ok, compliance ok, faithfulness
--                          0.92, 1 open high-risk drift, 2 fatal Sentry events,
--                          1 open + 1 applied proposal. Drives verdict asserts.
--   Story B (regression) — no positive signals (low maturity) + an applied
--                          proposal pre-seeded with outcome.score_before=90, so
--                          recording its outcome detects a regression and
--                          PROPOSES a gated rollback (loop-closure path).
-- Fixed UUID namespace 5e1f5e1f… ("self") keeps references stable across runs.
-- =============================================================================

-- ── Stories ──────────────────────────────────────────────────────────────────
INSERT INTO public.partner_stories (id, title) VALUES
  ('5e1f5e1f-0000-4000-8000-000000000001', 'Self-Eval Showcase — Healthy (ops fixture)'),
  ('5e1f5e1f-0000-4000-8000-000000000002', 'Self-Eval Showcase — Regression (ops fixture)')
ON CONFLICT (id) DO NOTHING;

-- ── App slot — links Story A to drift / Sentry signals (by app_name) ─────────
INSERT INTO public.coolify_app_slots (id, app_name, blue_app_uuid, green_app_uuid, active_slot, story_id) VALUES
  ('5e1f5e1f-0000-4000-8000-0000000000c1', 'self-eval-showcase-svc', 'se-blue-0001', 'se-green-0001', 'blue', '5e1f5e1f-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ── integration_events — 2 github webhooks (completed) + 1 deploy (completed)
--    → webhook_reliability 2/2, deployment 1/1. duration_ms is a GENERATED column
--    (= whole-second epoch of finished-started × 1000), so we drive it via a 1s
--    processing window → duration_ms 1000ms each, avg 1000ms.
INSERT INTO public.integration_events (id, event_source, external_id, event_type, status, story_id, processing_started_at, processing_finished_at, created_at) VALUES
  ('5e1f5e1f-0000-4000-8000-0000000000f1', 'github_webhook',  'se-wh-1',  'push',   'completed', '5e1f5e1f-0000-4000-8000-000000000001', now() - interval '3 days', now() - interval '3 days' + interval '1 second', now() - interval '3 days'),
  ('5e1f5e1f-0000-4000-8000-0000000000f2', 'github_webhook',  'se-wh-2',  'push',   'completed', '5e1f5e1f-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '2 days' + interval '1 second', now() - interval '2 days'),
  ('5e1f5e1f-0000-4000-8000-0000000000f3', 'deployment',      'se-dep-1', 'deploy', 'completed', '5e1f5e1f-0000-4000-8000-000000000001', now() - interval '1 day',  now() - interval '1 day'  + interval '1 second', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── ai_runs — one run for Story A with faithfulness 0.92 ─────────────────────
INSERT INTO public.ai_runs (id, kind, story_id, faithfulness_score_estimate, started_at) VALUES
  ('5e1f5e1f-0000-4000-8000-0000000000a1', 'dev_session', '5e1f5e1f-0000-4000-8000-000000000001', 0.92, now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

-- ── ai_trace_events — 2 compliance events (ok) tied to the run → compliance 2/2
INSERT INTO public.ai_trace_events (id, run_id, event_type, operation, status, created_at) VALUES
  ('5e1f5e1f-0000-4000-8000-0000000000b1', '5e1f5e1f-0000-4000-8000-0000000000a1', 'compliance_check', 'compliance_check', 'ok', now() - interval '2 days'),
  ('5e1f5e1f-0000-4000-8000-0000000000b2', '5e1f5e1f-0000-4000-8000-0000000000a1', 'compliance_check', 'compliance_gate',  'ok', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── drift_state — 1 open high-risk drift on the app → open_drift 1 / high 1 ──
INSERT INTO public.drift_state (id, app_uuid, app_name, drift_kind, risk_level, resolved_at) VALUES
  ('5e1f5e1f-0000-4000-8000-0000000000d1', 'se-blue-0001', 'self-eval-showcase-svc', 'env_var_value', 'high', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── sentry_issue_snapshot — 1 fatal issue (count 2) on the app → fatal_30d 2 ─
INSERT INTO public.sentry_issue_snapshot (id, sentry_issue_id, app_name, project_slug, level, title, first_seen, last_seen, status, count, observed_at) VALUES
  ('5e1f5e1f-0000-4000-8000-0000000000e1', 'se-iss-1', 'self-eval-showcase-svc', 'self-eval-showcase', 'fatal', 'Synthetic fatal (ops fixture)', now() - interval '3 days', now() - interval '1 hour', 'unresolved', 2, now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── story_goal_state — acceptance criteria + loop budget for Story A ─────────
INSERT INTO public.story_goal_state (story_id, acceptance_criteria, loop_iterations, loop_max) VALUES
  ('5e1f5e1f-0000-4000-8000-000000000001', '[{"id":1,"text":"Self-eval loop closes"},{"id":2,"text":"Outcome measured"}]'::jsonb, 2, 12)
ON CONFLICT (story_id) DO NOTHING;

-- ── improvement_proposals ────────────────────────────────────────────────────
-- A: applied 10d ago, no outcome yet → due 'baseline'; counts as applied_30d + learning (Story A).
-- B: open ('proposed'), scoped via metadata.story_id → open_proposals 1 (Story A).
-- C: applied 2d ago for Story B, pre-seeded outcome.score_before=90 → recording its
--    outcome computes Story B's (low) maturity → big negative delta → gated rollback.
INSERT INTO public.improvement_proposals (id, agent_slug, status, title, description, run_id, metadata, applied_at, created_at, outcome) VALUES
  ('5e1f5e1f-0000-4000-8000-00000000010a', 'dirigent', 'applied',  'Showcase applied tuning (ops fixture)',     'Applied proposal for self-eval outcome baseline.',        '5e1f5e1f-0000-4000-8000-0000000000a1', '{}'::jsonb,                                                        now() - interval '10 days', now() - interval '11 days', NULL),
  ('5e1f5e1f-0000-4000-8000-00000000020b', 'dirigent', 'proposed', 'Showcase open suggestion (ops fixture)',    'Open proposal counted by the self-eval verdict.',         NULL,                                   '{"story_id":"5e1f5e1f-0000-4000-8000-000000000001"}'::jsonb,        NULL,                       now() - interval '5 days',  NULL),
  ('5e1f5e1f-0000-4000-8000-00000000030c', 'dirigent', 'applied',  'Showcase regression scenario (ops fixture)','Applied proposal whose outcome regresses (gated rollback).',NULL,                                   '{"story_id":"5e1f5e1f-0000-4000-8000-000000000002"}'::jsonb,        now() - interval '2 days',  now() - interval '3 days',  '{"score_before": 90.0, "baseline_at": "2026-05-20T00:00:00Z"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
