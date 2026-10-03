-- pgTAP — the connector substrate (connector doctrine, DB layer)
-- ============================================================================
-- Pins the universal connector DB primitives:
--   connector_write_audit  — the ONE v2-hash audit site (internal-only)
--   hub_assert_source_writable — fail-closed governance gate over the story spine
--   hub_verify_provenance  — generic, entity-keyed provenance verdict
--   federated_caller_for / federated_identity_link — provider-generic federation,
--     fail-closed authz (no NULL-3VL idiom)
-- connector_write_audit's hash correctness is proven transitively by suite 15
-- (hub_write_audit delegates to it); here we pin governance + federation + generics.
-- Run via with-throwaway-db -- psql.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- ── shape: the single hash site exists + is internal-only ────────────────────
SELECT ok(EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'connector_write_audit'),
  'connector_write_audit exists (the one hash site)');
SELECT ok(
  NOT has_function_privilege('service_role',
    'public.connector_write_audit(text,text,text,text,text,text,text,jsonb,uuid,text,jsonb)', 'EXECUTE'),
  'connector_write_audit is internal-only (service_role cannot call it directly)');

-- ── hub_assert_source_writable: fail-CLOSED ─────────────────────────────────
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$ SELECT public.hub_assert_source_writable('00000000-0000-4000-a000-000000000000'::uuid, 'control-api') $$,
  '42501', NULL, 'assert_source_writable DENIES a story with no active instance');

-- seed an UNAPPROVED source on the spine → still denied
DO $seed$
DECLARE v_story uuid; v_inst uuid;
BEGIN
  v_story := public.ensure_stack_default_story();
  INSERT INTO public.story_instances (id, story_id, instance_label, status, is_origin, metadata)
  VALUES (gen_random_uuid(), v_story, 'pgtap-unapproved', 'active', true,
          jsonb_build_object('data_sensitivity', 'confidential', 'source_approved', false))
  RETURNING id INTO v_inst;
  INSERT INTO public.instance_endpoint_bindings (instance_id, endpoint_role, endpoint_url, is_active)
  VALUES (v_inst, 'control-api', 'https://example.invalid/api', true);
  PERFORM set_config('test.story', v_story::text, true);
END $seed$;

SELECT throws_ok(
  format($$ SELECT public.hub_assert_source_writable(%L::uuid, 'control-api') $$, current_setting('test.story')),
  '42501', NULL, 'assert_source_writable DENIES an unapproved source');

-- flip to approved → now returns the classification
UPDATE public.story_instances
   SET metadata = metadata || '{"source_approved": true}'::jsonb
 WHERE story_id = current_setting('test.story')::uuid;

SELECT is(
  public.hub_assert_source_writable(current_setting('test.story')::uuid, 'control-api'),
  'confidential',
  'assert_source_writable ALLOWS an approved source + returns its data_sensitivity');

-- ── federated_caller_for / federated_identity_link ──────────────────────────
-- seed a real aisha_auth.users row (identities FK + audit actor).
DO $usr$
DECLARE v_uid uuid := '00000000-0000-4000-c000-0000000000f1';
BEGIN
  INSERT INTO aisha_auth.users (id, email)
  VALUES (v_uid, 'pgtap-fed@example.com') ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('test.uid', v_uid::text, true);
END $usr$;

SELECT is(
  public.federated_caller_for('demo-commerce', current_setting('test.uid')::uuid),
  NULL,
  'federated_caller_for returns NULL for an unlinked user');

SELECT lives_ok(
  format($$ SELECT public.federated_identity_link('demo-commerce', %L::uuid, 'ext-777', 'e@x.cz') $$, current_setting('test.uid')),
  'federated_identity_link links an external identity');

SELECT is(
  public.federated_caller_for('demo-commerce', current_setting('test.uid')::uuid),
  'ext-777',
  'federated_caller_for resolves the linked provider_id (provider-generic)');

-- the link is audited through the v2-hashed path (not a raw INSERT)
SELECT is(
  public.hub_verify_provenance('federated_identity', current_setting('test.uid'), 'federated_identity.linked') ->> 'state',
  'verified',
  'federated_identity.linked audit row VERIFIES (audited via connector_write_audit)');

RESET ROLE;

-- ── fail-closed authz: a plain authenticated caller is denied ────────────────
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.federated_caller_for('demo-commerce', '00000000-0000-4000-c000-0000000000f1'::uuid) $$,
  NULL, 'federated_caller_for denies a non-admin/non-service caller (fail-closed)');
SELECT throws_ok(
  $$ SELECT public.federated_identity_link('demo-commerce', '00000000-0000-4000-c000-0000000000f1'::uuid, 'x') $$,
  NULL, 'federated_identity_link denies a non-admin/non-service caller (fail-closed)');
SELECT throws_ok(
  $$ SELECT public.hub_verify_provenance('federated_identity', 'x', 'y') $$,
  NULL, 'hub_verify_provenance denies a non-admin/non-service caller');

SELECT * FROM finish();
ROLLBACK;
