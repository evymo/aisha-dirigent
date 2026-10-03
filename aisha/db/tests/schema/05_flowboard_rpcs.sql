-- pgTAP schema-contract tests — Flowboard RPCs (save/get/list + agent catalog)
-- ============================================================================
-- The four SECURITY DEFINER RPCs behind the visual builder:
--   save_flowboard_graph(graph,name,id,engine_pin,status) → upsert; created_by = auth.uid()
--   get_flowboard_graph(id)        → owner-scoped fetch (admin/staff see all)
--   list_flowboard_graphs()        → owner-scoped list  (admin/staff see all)
--   get_flowboard_agent_catalog()  → active-agent palette (auth-required)
--
-- Proves the full owner-scoped contract end-to-end on the APPLIED (unseeded)
-- cold-start schema as superuser: save inserts + assigns created_by, get/list
-- surface the owner's flow, the upsert UPDATE path renames in place (no 2nd row),
-- the palette projects ACTIVE agents only, owner-only isolation (user B cannot see
-- user A's flow), and the auth.uid() guards (palette + save RAISE 42501 when
-- unauthenticated). Superuser bypasses RLS, so scoping is proven via each
-- function's own WHERE predicate. JWT identity simulated via request.jwt.claims.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- ── Identities ───────────────────────────────────────────────────────────────
SELECT set_config('fb.user_a', gen_random_uuid()::text, true);
SELECT set_config('fb.user_b', gen_random_uuid()::text, true);

-- ── Fixtures (FK/triggers off so the unseeded cold-start schema accepts them) ──
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES
  (current_setting('fb.user_a')::uuid),
  (current_setting('fb.user_b')::uuid);
-- One active agent for the palette + one inactive (must be excluded).
INSERT INTO agent_catalog (slug, display_name, purpose, default_model, is_active) VALUES
  ('fb-test-active',   'FB Active',   'p', 'balanced', true),
  ('fb-test-inactive', 'FB Inactive', 'p', 'balanced', false);
SET session_replication_role = origin;

-- ── Authenticate as A ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fb.user_a'), 'role', 'authenticated')::text, true);

-- (1) save inserts + returns the row; created_by = A
SELECT set_config('fb.gid',
  (save_flowboard_graph('{"nodes":[],"edges":[]}'::jsonb, 'My flow', NULL, NULL, NULL))->>'id', true);
SELECT isnt(current_setting('fb.gid'), NULL,
  '(1a) save_flowboard_graph returns a new graph id');
SELECT is(
  (SELECT created_by FROM flowboard_graphs WHERE id = current_setting('fb.gid')::uuid),
  current_setting('fb.user_a')::uuid,
  '(1b) save assigns created_by = auth.uid()');

-- (2) get returns A's flow
SELECT is(
  (get_flowboard_graph(current_setting('fb.gid')::uuid))->>'name',
  'My flow', '(2) get_flowboard_graph returns the owner''s flow by name');

-- (3) list includes A's flow
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(list_flowboard_graphs()) e
     WHERE e->>'id' = current_setting('fb.gid')),
  1, '(3) list_flowboard_graphs includes the owner''s flow');

-- (4) upsert UPDATE path renames in place
DO $upd$ BEGIN
  PERFORM save_flowboard_graph('{"nodes":[],"edges":[]}'::jsonb, 'Renamed flow',
    current_setting('fb.gid')::uuid, NULL, NULL);
END $upd$;
SELECT is(
  (get_flowboard_graph(current_setting('fb.gid')::uuid))->>'name',
  'Renamed flow', '(4a) save with p_id updates the existing flow in place');
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(list_flowboard_graphs())),
  1, '(4b) the upsert UPDATE path did not create a second row');

-- (5) palette projects the ACTIVE agent, excludes the inactive one
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(get_flowboard_agent_catalog()) a
     WHERE a->>'slug' = 'fb-test-active'),
  1, '(5a) get_flowboard_agent_catalog projects the active agent');
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(get_flowboard_agent_catalog()) a
     WHERE a->>'slug' = 'fb-test-inactive'),
  0, '(5b) get_flowboard_agent_catalog excludes inactive agents');

-- ── Authenticate as B — owner-only isolation ─────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('fb.user_b'), 'role', 'authenticated')::text, true);
SELECT ok(
  (get_flowboard_graph(current_setting('fb.gid')::uuid)) IS NULL,
  '(6) owner-only: B cannot fetch A''s flow via get_flowboard_graph');
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements(list_flowboard_graphs()) e
     WHERE e->>'id' = current_setting('fb.gid')),
  0, '(7) owner-only: A''s flow is absent from B''s list');

-- ── Unauthenticated — auth.uid() guards RAISE 42501 ──────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'authenticated')::text, true);
SELECT throws_ok(
  $fb$ SELECT get_flowboard_agent_catalog() $fb$,
  '42501', NULL, '(8) unauthenticated palette read is denied (42501)');
SELECT throws_ok(
  $fb$ SELECT save_flowboard_graph('{}'::jsonb, 'x', NULL, NULL, NULL) $fb$,
  '42501', NULL, '(9) unauthenticated save is denied (42501)');

SELECT * FROM finish();
ROLLBACK;
