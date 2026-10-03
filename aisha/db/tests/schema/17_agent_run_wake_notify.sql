-- pgTAP — agent-runner wake-on-event source (event-driven executor wake)
-- ============================================================================
-- fn_notify_queued_agent_run + trg_agent_runs_notify_queued fire NOTIFY
-- 'agent_run_queued' when a claude_cli_task becomes claimable, so svc-agent-runner
-- claims immediately (via event-worker → /wake) instead of waiting for its safety-net
-- poll. This asserts the objects exist and the trigger fires cleanly on every path;
-- the actual NOTIFY delivery + claimable/held gating is asserted by the raw-pg
-- integration test (src/tests/db/agent-run-wake-notify.integration.test.ts), since
-- pgTAP rolls back and never commits (NOTIFY is delivered at COMMIT).
-- Runs after baseline+heals; rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);
SELECT set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);

SELECT has_function('public', 'fn_notify_queued_agent_run', '(1) wake trigger fn exists');
SELECT has_trigger('public', 'agent_runs', 'trg_agent_runs_notify_queued',
  '(2) wake trigger installed on agent_runs');

SELECT lives_ok(
  $$INSERT INTO public.agent_runs (kind, profile, image, source, status, approval_required)
    VALUES ('claude_cli_task','docker','img','pgtap-claimable','queued', false)$$,
  '(3) a claimable claude_cli_task insert fires the wake trigger without error');

SELECT lives_ok(
  $$INSERT INTO public.agent_runs (kind, profile, image, source, status, approval_required)
    VALUES ('claude_cli_task','docker','img','pgtap-held','queued', true)$$,
  '(4) a held (approval-required) insert fires the wake trigger without error');

SELECT lives_ok(
  $$INSERT INTO public.agent_runs (kind, profile, image, source, status, approval_required)
    VALUES ('repo-agent','docker','img','pgtap-other','queued', false)$$,
  '(5) a non-claude_cli_task insert is a clean no-op for the wake trigger');

SELECT * FROM finish();
ROLLBACK;
