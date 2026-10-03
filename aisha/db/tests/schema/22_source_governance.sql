-- pgTAP schema-contract tests — federated-source governance (the #572 rebuild)
-- ============================================================================
-- Proves the two keystone RPCs that make live source-read GENERIC + GOVERNED:
--
--   audience_resolve_source_binding(story_id, endpoint_role)
--     — resolves a source's endpoint + credential REFERENCE over the story spine
--       (story_instances + instance_endpoint_bindings), and reports is_approved.
--       Admin/service ONLY (NULL-safe deny-guard). Fail-closed: an unapproved or
--       unclassified source resolves is_approved=false so the broker route 403s.
--
--   audience_admin_approve_source(instance_id, data_sensitivity)
--     — operator-ONLY activation that REFUSES an incompletely-classified source
--       (source_type/data_sensitivity/retention_class/legal_basis/namespace) and
--       flips metadata.source_approved — the exact flag the resolver gates on.
--       This closes the approve<->read decoupling the original #572 shipped.
--
-- The security crux (N2): neither the source CONFIG nor the read is reachable by
-- anon — proven at BOTH the grant layer (no anon EXECUTE) and the runtime layer
-- (42501 for a non-admin/non-service caller).
--
-- Runs UNSEEDED as superuser (RLS bypassed; the function-internal guards are the
-- subject, exercised via request.jwt.claims identity switches). Rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

-- ── Identities ───────────────────────────────────────────────────────────────
SELECT set_config('sg.admin',    gen_random_uuid()::text, true);
SELECT set_config('sg.plain',    gen_random_uuid()::text, true);  -- authenticated, NOT admin
SELECT set_config('sg.story',    gen_random_uuid()::text, true);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Admin identity (is_admin_or_staff reads user_roles); FK/triggers off for the
-- unseeded aisha_auth insert only.
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES (current_setting('sg.admin')::uuid);
INSERT INTO aisha_auth.users (id) VALUES (current_setting('sg.plain')::uuid);
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('sg.admin')::uuid, 'admin');
-- Obsah od DVOU různých tvůrců. Bez něj by tvrzení „autor vidí jen své"
-- platilo prázdně a nedokazovalo nic — mlčení není měření.
INSERT INTO news_articles (slug, title_key, content_key, created_by) VALUES
  ('sg-clanek-admina', 'sg.admin.title', 'sg.admin.body', current_setting('sg.admin')::uuid),
  ('sg-clanek-autora', 'sg.plain.title', 'sg.plain.body', current_setting('sg.plain')::uuid);
SET session_replication_role = origin;

-- Authenticate as admin to build the source (register_story_instance is admin-gated).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('sg.admin'), 'role', 'authenticated')::text, true);

-- A federated source IS a story, materialised on an origin instance, with a
-- source_pg_readonly endpoint binding. Classification starts EMPTY (metadata {})
-- — the source is registered but NOT yet classified/approved.
INSERT INTO partner_stories (id, title)
  VALUES (current_setting('sg.story')::uuid, 'Federated source story');

SELECT set_config('sg.instance',
  (public.register_story_instance('src-origin', 'cloud', true, current_setting('sg.story')::uuid))->>'instance_id',
  true);

INSERT INTO instance_endpoint_bindings
  (instance_id, endpoint_role, endpoint_url, auth_method, auth_secret_ref, is_active)
VALUES
  (current_setting('sg.instance')::uuid, 'source_pg_readonly',
   'postgres://source-replica.internal/crm', 'pg_dsn', 'secret-ref://source-pg-dsn', true);

-- ════════════════════════════════════════════════════════════════════════════
-- (A) SECURITY: anon reaches neither the config nor the read — grant + runtime.
-- ════════════════════════════════════════════════════════════════════════════
SELECT ok(
  NOT has_function_privilege('anon', 'public.audience_resolve_source_binding(uuid, text)', 'EXECUTE'),
  '(1) anon has NO EXECUTE on audience_resolve_source_binding (no source config to anon)');

SELECT ok(
  NOT has_function_privilege('anon', 'public.audience_admin_approve_source(uuid, text)', 'EXECUTE'),
  '(2) anon has NO EXECUTE on audience_admin_approve_source');

-- Runtime deny: a plain authenticated (non-admin, non-service) caller is refused.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('sg.plain'), 'role', 'authenticated')::text, true);

SELECT throws_ok(
  format($q$SELECT * FROM public.audience_resolve_source_binding(%L::uuid)$q$, current_setting('sg.story')),
  '42501', NULL,
  '(3) a non-admin/non-service caller is denied the source binding (42501)');

SELECT throws_ok(
  format($q$SELECT public.audience_admin_approve_source(%L::uuid)$q$, current_setting('sg.instance')),
  '42501', NULL,
  '(4) a non-admin caller cannot approve a source (42501)');

-- Back to admin for the lifecycle assertions.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('sg.admin'), 'role', 'authenticated')::text, true);

-- ════════════════════════════════════════════════════════════════════════════
-- (B) FAIL-CLOSED: an unapproved source resolves is_approved=false (route 403s),
--     yet still exposes its endpoint + credential REFERENCE (never a secret).
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  (SELECT is_approved FROM public.audience_resolve_source_binding(current_setting('sg.story')::uuid)),
  false,
  '(5) BEFORE approval the binding resolves is_approved=false (fail-closed)');

SELECT is(
  (SELECT endpoint_url FROM public.audience_resolve_source_binding(current_setting('sg.story')::uuid)),
  'postgres://source-replica.internal/crm',
  '(6) resolver returns the bound endpoint_url from the spine');

SELECT is(
  (SELECT auth_secret_ref FROM public.audience_resolve_source_binding(current_setting('sg.story')::uuid)),
  'secret-ref://source-pg-dsn',
  '(7) resolver returns the credential REFERENCE, not a secret');

-- ════════════════════════════════════════════════════════════════════════════
-- (C) CLASSIFY-BEFORE-ACTIVATE: approve refuses an incompletely-classified source.
-- ════════════════════════════════════════════════════════════════════════════
SELECT throws_ok(
  format($q$SELECT public.audience_admin_approve_source(%L::uuid)$q$, current_setting('sg.instance')),
  '23514', NULL,
  '(8) approving an unclassified source is rejected (check_violation)');

-- Now classify the source fully (the 4-dimension contract + namespace).
UPDATE public.story_instances
   SET metadata = metadata || jsonb_build_object(
     'source_type',     'external',
     'data_sensitivity','confidential',
     'retention_class', 'long_term',
     'legal_basis',     'legitimate_interest',
     'namespace',       'source:crm'
   )
 WHERE id = current_setting('sg.instance')::uuid;

SELECT is(
  (public.audience_admin_approve_source(current_setting('sg.instance')::uuid)) ->> 'approved',
  'true',
  '(9) a fully-classified source approves successfully');

-- ════════════════════════════════════════════════════════════════════════════
-- (D) APPROVE<->READ TIE: after approval the resolver reports is_approved=true.
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  (SELECT is_approved FROM public.audience_resolve_source_binding(current_setting('sg.story')::uuid)),
  true,
  '(10) AFTER approval the binding resolves is_approved=true (route may read)');

SELECT is(
  (SELECT data_sensitivity FROM public.audience_resolve_source_binding(current_setting('sg.story')::uuid)),
  'confidential',
  '(11) resolver reports the classified data_sensitivity');

-- ════════════════════════════════════════════════════════════════════════════
-- (E) THE 3 GOVERNED PII DASHBOARDS: no anon EXECUTE + non-admin runtime deny.
--     A regression dropping is_admin_or_staff() in any of these silently re-opens
--     the #572 N2 leak (creator/subject/operator email PII to any logged-in user)
--     — the cold-start grant gate would stay green (authenticated EXECUTE is by
--     design), so ONLY a runtime 42501 assertion catches it.
-- ════════════════════════════════════════════════════════════════════════════
SELECT ok(
  NOT has_function_privilege('anon', 'public.audience_admin_gdpr_erasure_log(integer, integer)', 'EXECUTE'),
  '(12) anon has NO EXECUTE on audience_admin_gdpr_erasure_log');

SELECT ok(
  NOT has_function_privilege('anon', 'public.audience_admin_content_reach(integer, integer)', 'EXECUTE'),
  '(13) anon has NO EXECUTE on audience_admin_content_reach');

SELECT ok(
  NOT has_function_privilege('anon', 'public.audience_admin_source_onboarding()', 'EXECUTE'),
  '(14) anon has NO EXECUTE on audience_admin_source_onboarding');

-- Switch to a plain authenticated (non-admin) identity: the gate must RAISE 42501
-- before any table/PII access.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('sg.plain'), 'role', 'authenticated')::text, true);

SELECT throws_ok(
  $q$SELECT * FROM public.audience_admin_gdpr_erasure_log()$q$,
  '42501', NULL,
  '(15) non-admin caller is denied audience_admin_gdpr_erasure_log (42501)');

-- ⭐ ROLE ROZHODUJÍ, KOLIK KDO VIDÍ — NE JESTLI SMÍ DOVNITŘ.
-- Přístup do extranetu není výsadou staff/admin: přihlášený autor má na svůj
-- Creator Studio nárok. Rozsah řeší filtr `creator_user_id = auth.uid()` ZA
-- unionem, takže platí na obě větve (news i stories) a stránkuje se už zúžený
-- výsledek. PII (#572 finding N2) se neotevírá — autor dosáhne jen na SVŮJ
-- creator_email. Do 2026-08-11 tu stálo „ne-admin je odmítnut"; to byl kontrakt
-- binární (admin/nikdo) a Creator Studio pod ním nemohlo existovat.
SELECT lives_ok(
  $q$SELECT * FROM public.audience_admin_content_reach()$q$,
  '(16) authenticated non-admin is NOT denied audience_admin_content_reach (Creator Studio)');

SELECT throws_ok(
  $q$SELECT * FROM public.audience_admin_source_onboarding()$q$,
  '42501', NULL,
  '(17) non-admin caller is denied audience_admin_source_onboarding (42501)');

-- (18) …ale VIDÍ JEN SVÉ. Tohle je vlastní bezpečnostní tvrzení: ne „kdo je
-- odmítnut", ale „kam kdo dosáhne". Počítáme řádky CIZÍCH tvůrců — musí být nula.
SELECT is(
  (SELECT count(*)::int FROM public.audience_admin_content_reach()
     WHERE creator_user_id IS DISTINCT FROM current_setting('sg.plain')::uuid),
  0,
  '(18) author reaches ONLY their own rows — zero foreign creators');

-- (19) Admin naopak vidí OBA tvůrce. Bez tohohle by (18) mohlo projít prostě
-- proto, že fixtura je prázdná — a zelená by znamenala „nenašel jsem", ne „není".
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('sg.admin'), 'role', 'authenticated')::text, true);
SELECT cmp_ok(
  (SELECT count(DISTINCT creator_user_id)::int FROM public.audience_admin_content_reach()),
  '>=', 2,
  '(19) admin/staff reaches EVERY creator (fixture proves 18 is not vacuous)');

-- (20) Anonym zůstává odmítnut — role chybí i identita.
SELECT set_config('request.jwt.claims',
  json_build_object('role', 'anon')::text, true);
SELECT throws_ok(
  $q$SELECT * FROM public.audience_admin_content_reach()$q$,
  '42501', NULL,
  '(20) anonymous caller is denied audience_admin_content_reach (42501)');

SELECT * FROM finish();
ROLLBACK;
