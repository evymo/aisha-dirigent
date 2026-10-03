-- pgTAP schema-contract tests — evidence registry (E3/E5, #679)
-- ============================================================================
-- Proves the two SECURITY DEFINER audited RPCs + the default-deny RLS that make
-- the evidence registry write-only-by-service and read-only-by-admin:
--
--   register_source_document_audited(source_slug, sha256, doc_type, …)
--     — service-role ONLY (NULL-safe is_service_role deny-guard). Only an ACTIVE
--       source may register; sensitivity is INHERITED from the source (never
--       caller-supplied); idempotent on (source, content hash).
--
--   upsert_contract_extract_audited(document_id, extract, …, obligations)
--     — service-role ONLY. Re-extract DROPS human_verified; obligations are
--       replaced atomically and are ALWAYS born human_confirmed=false.
--
-- Security crux: neither RPC is reachable by anon/authenticated (42501 at the
-- runtime guard), the registry tables are RLS default-deny (admin/staff SELECT
-- only, service_role full), and anon has no table grant at all.
--
-- Runs UNSEEDED as superuser (RLS bypassed for setup; guards + RLS exercised via
-- request.jwt.claims + SET LOCAL ROLE identity switches). Rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(18);

-- ── Identities ───────────────────────────────────────────────────────────────
SELECT set_config('er.admin', gen_random_uuid()::text, true);
SELECT set_config('er.plain', gen_random_uuid()::text, true);  -- authenticated, NOT admin
SELECT set_config('er.svc',   gen_random_uuid()::text, true);
SELECT set_config('er.sha',   repeat('a', 64), true);          -- valid 64-hex content hash

-- Admin identity in user_roles (is_admin_or_staff reads it); FK/triggers off for
-- the unseeded aisha_auth insert only.
-- er.svc is inserted too: the audited RPCs log auth.uid() into audit_journal
-- (FK → aisha_auth.users), and the service_role JWT below carries sub=er.svc.
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id)
  VALUES (current_setting('er.admin')::uuid), (current_setting('er.plain')::uuid),
         (current_setting('er.svc')::uuid);
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('er.admin')::uuid, 'admin');
SET session_replication_role = origin;

-- Fixture: one ACTIVE, fully-classified source (activation_guard needs the
-- contract 4D set + owner: source_type, data_sensitivity, retention_class,
-- legal_basis, owner — Source Onboarding Contract §1/§3).
INSERT INTO agent_knowledge_sources (source_slug, namespace, is_active, config)
VALUES ('acme-legal', 'tenant/acme/legal', true,
        jsonb_build_object('source_type','partner','data_sensitivity','restricted',
                           'retention_class','long_term','legal_basis','contract',
                           'owner','ops'));

-- ════════════════════════════════════════════ register_source_document_audited
-- (1) deny: authenticated (non-service) caller → 42501 (body deny-guard fires)
SELECT set_config('request.jwt.claims',
  json_build_object('role','authenticated','sub',current_setting('er.plain'))::text, true);
SELECT throws_ok(
  $$ SELECT register_source_document_audited('acme-legal', current_setting('er.sha'), 'contract') $$,
  '42501', NULL, 'register: authenticated caller is denied (service-role only)');

-- (2) deny: anon caller → 42501
SELECT set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
SELECT throws_ok(
  $$ SELECT register_source_document_audited('acme-legal', current_setting('er.sha'), 'contract') $$,
  '42501', NULL, 'register: anon caller is denied');

-- switch to service_role for the happy paths
SELECT set_config('request.jwt.claims',
  json_build_object('role','service_role','sub',current_setting('er.svc'))::text, true);

-- (3) unknown / inactive source → P0002
SELECT throws_ok(
  $$ SELECT register_source_document_audited('no-such-source', current_setting('er.sha'), 'contract') $$,
  'P0002', NULL, 'register: unknown source is rejected (fail-closed)');

-- (4) happy path: registered=true
SELECT is(
  (register_source_document_audited('acme-legal', current_setting('er.sha'), 'contract')->>'registered')::boolean,
  true, 'register: first call registers the document');

-- (5) sensitivity INHERITED from the source (restricted), not caller-supplied
SELECT is(
  (SELECT sensitivity FROM document_registry WHERE source_sha256 = current_setting('er.sha')),
  'restricted', 'register: sensitivity is inherited from the source classification');

-- (6) idempotent replay: same (source, sha) → registered=false
SELECT is(
  (register_source_document_audited('acme-legal', current_setting('er.sha'), 'contract')->>'registered')::boolean,
  false, 'register: replay is idempotent (registered=false)');

-- (7) …and creates no duplicate row
SELECT is(
  (SELECT count(*)::int FROM document_registry WHERE source_sha256 = current_setting('er.sha')),
  1, 'register: replay does not create a duplicate row');

SELECT set_config('er.doc',
  (SELECT id::text FROM document_registry WHERE source_sha256 = current_setting('er.sha')), true);

-- ═══════════════════════════════════════════ upsert_contract_extract_audited
-- (8) deny: authenticated caller → 42501
SELECT set_config('request.jwt.claims',
  json_build_object('role','authenticated','sub',current_setting('er.plain'))::text, true);
SELECT throws_ok(
  $$ SELECT upsert_contract_extract_audited(current_setting('er.doc')::uuid, '{}'::jsonb) $$,
  '42501', NULL, 'upsert: authenticated caller is denied (service-role only)');

-- back to service_role
SELECT set_config('request.jwt.claims',
  json_build_object('role','service_role','sub',current_setting('er.svc'))::text, true);

-- (9) unknown document → P0002
SELECT throws_ok(
  $$ SELECT upsert_contract_extract_audited(gen_random_uuid(), '{}'::jsonb) $$,
  'P0002', NULL, 'upsert: unknown document is rejected');

-- (10) happy path with one obligation → obligation count
SELECT set_config('er.obl', jsonb_build_array(jsonb_build_object(
  'obliged_party','ACME', 'action','pay', 'consequence','penalty',
  'due_rule',      jsonb_build_object('kind','net_days','days',14),
  'source_clause', jsonb_build_object('section','4.1','char_start',10,'char_end',80)
))::text, true);
SELECT is(
  (upsert_contract_extract_audited(current_setting('er.doc')::uuid, jsonb_build_object('x',1),
     0.9, 'ACME', 'MSA', NULL, NULL, current_setting('er.obl')::jsonb)->>'obligations')::int,
  1, 'upsert: returns the inserted obligation count');

SELECT set_config('er.contract',
  (SELECT id::text FROM contract_register WHERE document_id = current_setting('er.doc')::uuid), true);

-- (11) obligations are born human_confirmed=false
SELECT is(
  (SELECT bool_and(NOT human_confirmed) FROM obligation_register
     WHERE contract_id = current_setting('er.contract')::uuid),
  true, 'upsert: obligations are born human_confirmed=false');

-- simulate a human confirming the extract…
UPDATE contract_register
   SET human_verified = true, verified_by = current_setting('er.admin')::uuid, verified_at = now()
 WHERE id = current_setting('er.contract')::uuid;
-- …then a re-extract (no obligations) must reset verification and empty the set
SELECT upsert_contract_extract_audited(current_setting('er.doc')::uuid, jsonb_build_object('x',2), 0.8);

-- (12) re-extract DROPS human_verified
SELECT is(
  (SELECT human_verified FROM contract_register WHERE id = current_setting('er.contract')::uuid),
  false, 'upsert: re-extract drops human_verified');

-- (13) …and clears verified_at
SELECT is(
  (SELECT verified_at FROM contract_register WHERE id = current_setting('er.contract')::uuid),
  NULL::timestamptz, 'upsert: re-extract clears verified_at');

-- (14) obligations replaced atomically (re-extract with none empties the set)
SELECT is(
  (SELECT count(*)::int FROM obligation_register WHERE contract_id = current_setting('er.contract')::uuid),
  0, 'upsert: re-extract atomically replaced (emptied) the obligation set');

-- ══════════════════════════════════════════════════════════════ RLS default-deny
-- (15) RLS enabled on all four registry tables
SELECT is(
  (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE relname IN ('agent_knowledge_sources','document_registry','contract_register','obligation_register')),
  true, 'rls: enabled on all four registry tables');

-- (16) a NON-admin authenticated caller reads zero rows (default-deny)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('role','authenticated','sub',current_setting('er.plain'))::text, true);
SELECT is((SELECT count(*)::int FROM document_registry), 0,
  'rls: a non-admin authenticated caller reads zero rows');
RESET ROLE;

-- (17) an admin/staff caller CAN read the row
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('role','authenticated','sub',current_setting('er.admin'))::text, true);
SELECT is((SELECT count(*)::int FROM document_registry), 1,
  'rls: an admin/staff caller reads the registered document');
RESET ROLE;

-- (18) anon has no table grant at all (defense at the grant layer, not just RLS)
SELECT ok(NOT has_table_privilege('anon', 'public.document_registry', 'SELECT'),
  'rls: anon has no SELECT grant on document_registry');

SELECT finish();
ROLLBACK;
