-- pgTAP schema-contract tests — ACS core (Agent Communication Standard, #678)
-- ============================================================================
-- Proves the DB chokepoint the ACS layer relies on: SECURITY DEFINER write
-- paths guarded by is_service_role(), immutable intents (R3), append-only log
-- (R6), default-deny ACL (R6), the readback effect state machine (R5), and —
-- the merge-blocking security fix — RLS default-deny so anon/authenticated
-- can NOT read inter-agent traffic (the original migration GRANT SELECT ... TO
-- PUBLIC exposed it cross-tenant).
--
-- Runs as superuser (RLS bypassed for setup; guards + RLS exercised via
-- request.jwt.claims + SET LOCAL ROLE). Rolled back. Měří totéž nad DB bez seedu
-- (CI) i se seedem (with-throwaway-db): fixture nesdílí jedinečný klíč se seedem.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

-- ── Identities + fixed valid ids (Crockford base32, 26 chars) ────────────────
SELECT set_config('acs.admin', gen_random_uuid()::text, true);
SELECT set_config('acs.plain', gen_random_uuid()::text, true);
SELECT set_config('acs.svc',   gen_random_uuid()::text, true);
SELECT set_config('acs.mid',   '01ARZ3NDEKTSV4RRFFQ69G5FAV', true);          -- message_id
SELECT set_config('acs.mid2',  '01ARZ3NDEKTSV4RRFFQ69G5FB0', true);
SELECT set_config('acs.iid',   'int_01ARZ3NDEKTSV4RRFFQ69G5FAV', true);      -- intent_id
SELECT set_config('acs.sha',   repeat('a', 64), true);

-- Admin identity (is_admin_or_staff reads user_roles).
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id)
  VALUES (current_setting('acs.admin')::uuid), (current_setting('acs.plain')::uuid);
INSERT INTO user_roles (user_id, role) VALUES (current_setting('acs.admin')::uuid, 'admin');
SET session_replication_role = origin;

-- Fixture: a registered contract schema (no create-schema RPC → direct insert).
-- ⛔ NAMĚŘENO 2026-09-13: fixture dřív vkládal 'acs.task.assign@1.0' — totéž schéma
-- nese seed (core ACS registry, seed.compiled.sql ř. ~4673). Nad DB se seedem
-- (with-throwaway-db → run-schema-tests) test padal 23505 acs_message_schemas_pkey,
-- v CI (baseline + heals BEZ seedu) procházel: měřil, zda DB má seed, ne ACS vrstvu.
-- Schéma je proto VLASTNÍ testu (jméno, které žádný seed nenese) a ACL/envelope
-- níže na něj ukazují — tvrzení testu (guard, R3, R5, R6, RLS) se nemění, jen už
-- nesdílí řádek se seedem (ani jeho ACL řádky, které seed k 'acs.task.assign@1.0'
-- přidává). Brána: pgtap-fixture-nekoliduje-se-seedem.gate.test.ts.
SELECT set_config('acs.schema', 'pgtap.acs-core.fixture@1.0', true);
INSERT INTO acs_message_schemas (schema_ref, json_schema, semantics, mode)
  VALUES (current_setting('acs.schema'), '{}'::jsonb, 'test', 'shadow');

-- ════════════════════════════════════════════════ intents: guard + immutable
-- (1) authenticated caller denied
SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('acs.plain'))::text, true);
SELECT throws_ok(
  $$ SELECT acs_create_intent(current_setting('acs.iid'), '{"q":1}'::jsonb, current_setting('acs.sha'), 'internal', 'svc-test') $$,
  '42501', NULL, 'acs_create_intent: authenticated caller is denied');

-- switch to service_role
SELECT set_config('request.jwt.claims', json_build_object('role','service_role','sub',current_setting('acs.svc'))::text, true);

-- (2) happy path returns the intent id
SELECT is(
  acs_create_intent(current_setting('acs.iid'), '{"q":1}'::jsonb, current_setting('acs.sha'), 'internal', 'svc-test'),
  current_setting('acs.iid'), 'acs_create_intent: service role creates the intent');

-- (3) idempotent replay (same id + same content hash) returns the id
SELECT is(
  acs_create_intent(current_setting('acs.iid'), '{"q":1}'::jsonb, current_setting('acs.sha'), 'internal', 'svc-test'),
  current_setting('acs.iid'), 'acs_create_intent: idempotent replay of identical content');

-- (4) same id, different content hash → immutability violation
SELECT throws_ok(
  format($$ SELECT acs_create_intent(%L, '{"q":2}'::jsonb, %L, 'internal', 'svc-test') $$,
         current_setting('acs.iid'), repeat('b',64)),
  NULL, NULL, 'acs_create_intent: same id with different content is rejected');

-- (5)(6) intents are immutable (R3) — UPDATE + DELETE blocked by trigger
SELECT throws_ok(
  $$ UPDATE acs_intents SET created_by = 'x' WHERE intent_id = current_setting('acs.iid') $$,
  NULL, NULL, 'acs_intents: UPDATE is blocked (immutable R3)');
SELECT throws_ok(
  $$ DELETE FROM acs_intents WHERE intent_id = current_setting('acs.iid') $$,
  NULL, NULL, 'acs_intents: DELETE is blocked (immutable R3)');

-- ════════════════════════════════════════════ ingest: guard + dedup + log R6
-- (7) authenticated denied
SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('acs.plain'))::text, true);
SELECT throws_ok(
  $$ SELECT acs_ingest_message('{}'::jsonb) $$,
  '42501', NULL, 'acs_ingest_message: authenticated caller is denied');

SELECT set_config('request.jwt.claims', json_build_object('role','service_role','sub',current_setting('acs.svc'))::text, true);
SELECT set_config('acs.env', json_build_object(
  'envelope', json_build_object(
    'schema',current_setting('acs.schema'), 'message_id', current_setting('acs.mid'),
    'intent_id', current_setting('acs.iid'), 'correlation_id', current_setting('acs.mid'),
    'sender','svc-a', 'recipient','svc-b', 'sent_at','2026-07-10T00:00:00Z',
    'trust', json_build_object('level','internal')),
  'payload', json_build_object('task','do')
)::text, true);

-- (8) valid envelope → accepted (NULL) + row logged
SELECT is(
  acs_ingest_message(current_setting('acs.env')::jsonb),
  NULL, 'acs_ingest_message: valid envelope is accepted (no rejection code)');
SELECT is(
  (SELECT count(*)::int FROM acs_message_log WHERE message_id = current_setting('acs.mid')),
  1, 'acs_ingest_message: the message was appended to the log');

-- (9) duplicate message_id → duplicate_message
SELECT is(
  acs_ingest_message(current_setting('acs.env')::jsonb),
  'duplicate_message', 'acs_ingest_message: replayed message_id is a duplicate');

-- (10) unknown schema → unknown_schema (mid2, schema not registered)
SELECT is(
  acs_ingest_message(json_build_object(
    'envelope', json_build_object('schema','nope.x@9.9','message_id',current_setting('acs.mid2'),
      'intent_id',current_setting('acs.iid'),'correlation_id',current_setting('acs.mid2'),
      'sender','a','recipient','b','sent_at','2026-07-10T00:00:00Z','trust','{}'::jsonb),
    'payload', '{}'::jsonb)::jsonb),
  'unknown_schema', 'acs_ingest_message: unregistered schema is rejected');

-- (11)(12) log is append-only (R6)
SELECT throws_ok(
  $$ UPDATE acs_message_log SET sender = 'x' WHERE message_id = current_setting('acs.mid') $$,
  NULL, NULL, 'acs_message_log: UPDATE is blocked (append-only R6)');
SELECT throws_ok(
  $$ DELETE FROM acs_message_log WHERE message_id = current_setting('acs.mid') $$,
  NULL, NULL, 'acs_message_log: DELETE is blocked (append-only R6)');

-- ════════════════════════════════════════════════════════ ACL default-deny
-- (13) no ACL row → deny
SELECT is(acs_check_acl('svc-x', current_setting('acs.schema'), 'svc-y'), false,
  'acs_check_acl: default deny (no row)');
INSERT INTO acs_agent_acl (sender_pattern, schema_ref, recipient_pattern)
  VALUES ('svc-x.', current_setting('acs.schema'), 'svc-y');
-- (14) prefix match (sender_pattern ends '.') → allow
SELECT is(acs_check_acl('svc-x.planner', current_setting('acs.schema'), 'svc-y'), true,
  'acs_check_acl: prefix sender pattern allows');
-- (15) non-matching recipient → deny
SELECT is(acs_check_acl('svc-x.planner', current_setting('acs.schema'), 'svc-z'), false,
  'acs_check_acl: recipient outside the row is denied');

-- ════════════════════════════════════════════ effect readback state machine
-- (16) propose denied for authenticated
SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('acs.plain'))::text, true);
SELECT throws_ok(
  $$ SELECT acs_effect_propose('{}'::jsonb) $$,
  '42501', NULL, 'acs_effect_propose: authenticated caller is denied');

SELECT set_config('request.jwt.claims', json_build_object('role','service_role','sub',current_setting('acs.svc'))::text, true);
SELECT set_config('acs.eff', 'eff_01ARZ3NDEKTSV4RRFFQ69G5FAV', true);
SELECT set_config('acs.effpayload', json_build_object(
  'effect_id', current_setting('acs.eff'), 'intent_ref', current_setting('acs.iid'),
  'tool_name','demo','effect_class','write',
  'proposal', json_build_object('params_sha256', repeat('c',64))
)::text, true);

-- (17) propose → confirmed → executed happy path
SELECT is(acs_effect_propose(current_setting('acs.effpayload')::jsonb), current_setting('acs.eff'),
  'acs_effect_propose: returns the effect id');
SELECT lives_ok(
  format($$ SELECT acs_effect_decide(%L, %s) $$, current_setting('acs.eff'),
         quote_literal(json_build_object('decision','confirm','params_sha256',repeat('c',64))::text) || '::jsonb'),
  'acs_effect_decide: confirm with matching params hash transitions to confirmed');
SELECT is((SELECT state FROM acs_pending_effects WHERE effect_id = current_setting('acs.eff')),
  'confirmed', 'acs_effect_decide: state is confirmed');

-- (18) params hash mismatch is rejected (R5 drift) — propose a 2nd effect, decide with wrong hash
SELECT acs_effect_propose(json_build_object('effect_id','eff_01ARZ3NDEKTSV4RRFFQ69G5FB0',
  'intent_ref',current_setting('acs.iid'),'tool_name','demo','effect_class','write',
  'proposal', json_build_object('params_sha256', repeat('d',64)))::jsonb);
SELECT throws_ok(
  $$ SELECT acs_effect_decide('eff_01ARZ3NDEKTSV4RRFFQ69G5FB0',
       json_build_object('decision','confirm','params_sha256',repeat('e',64))::jsonb) $$,
  NULL, NULL, 'acs_effect_decide: params hash mismatch is rejected (R5)');

-- ════════════════════════════════════════════════════ RLS default-deny (fix)
-- (19) anon has NO access — the cross-tenant hole is closed at the GRANT layer.
-- grants/acs.sql REVOKEs anon entirely ("anon nemá nic" per #566): inter-agent ACS
-- traffic is stricter than the anon-SELECT+RLS floor and is not anon-readable at all,
-- so the acs REVOKE (applied after the fix_missing_table_grants floor, in both the
-- baseline and the heal) leaves anon with zero grants → anon gets permission-denied
-- (42501), not zero rows. (authenticated below keeps the floor grant + RLS-gates to 0.)
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
SELECT throws_ok(
  'SELECT count(*)::int FROM public.acs_message_log',
  '42501', NULL,
  'grant: anon has no ACS access — cross-tenant read closed at the grant layer (anon nemá nic, #566)');
RESET ROLE;

-- (20) a non-admin authenticated caller reads zero rows (RLS default-deny)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub',current_setting('acs.plain'))::text, true);
SELECT is((SELECT count(*)::int FROM acs_message_log), 0,
  'rls: a non-admin authenticated caller reads zero ACS traffic');
RESET ROLE;

SELECT finish();
ROLLBACK;
