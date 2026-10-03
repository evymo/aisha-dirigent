-- pgTAP acceptance — AISHA Omni · area: reflection-poll-authz
-- ============================================================================
-- Locks fn_user_can_read_run — the on-behalf-of authorization the reflection-poll
-- endpoint (GET /reflect/runs/:id) uses to let an UNSCOPED or LEGACY PAT drain ITS
-- OWN deferred run (a scoped PAT is still authorized by its token scope, unchanged).
-- The fn mirrors the canonical ai_runs read authority (participant_read_ai_runs +
-- admin_staff_read_ai_runs) and adds the story OWNER.
--
-- Invariants asserted: owner→true, foreign user→false (no over-grant), unknown run
-- id→false (fail-closed, no existence oracle). The admin path delegates to the shared,
-- separately-tested is_admin_or_staff (asserting it here would need a real users row —
-- user_roles.user_id has a FK to users).
--
-- ISOLATION: lives under aisha/db/tests/schema/omni/ — executed only by the omni
-- acceptance runner (not the default non-recursive schema-test sweep). BEGIN…ROLLBACK
-- + pgtap so nothing persists. Uživatelé se zakládají v aisha_auth.users (FK).
-- ai_runs.story_id is NOT NULL (§16/§20), so a system run (NULL
-- story) cannot exist — that defensive fn branch is intentionally not exercised.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

SELECT has_function('public', 'fn_user_can_read_run', ARRAY['uuid', 'uuid'],
  'positive: fn_user_can_read_run(uuid,uuid) exists (reflection-poll OBO authz)');

-- ── Hermetic fixtures (rolled back) ─────────────────────────────────────────
-- A story owned by OWNER, a run in that story, and a FOREIGN user with no
-- relationship to the story. partner_stories.user_id MÁ FK na aisha_auth.users
-- (dřívější poznámka „no FK — JIT users" už neplatila a soubor padal na FK už
-- před 2026-09-19; default runner omni/ nesbírá, takže si toho nikdo nevšiml).
INSERT INTO aisha_auth.users (id) VALUES
  ('a5100000-0000-0000-0000-0000000000ee'),
  ('a5100000-0000-0000-0000-0000000000ff')
  ON CONFLICT DO NOTHING;
INSERT INTO public.partner_stories (id, title, user_id)
  VALUES ('a5100000-0000-0000-0000-000000000001', 'pgtap-poll-authz', 'a5100000-0000-0000-0000-0000000000ee');
INSERT INTO public.ai_runs (id, kind, story_id)
  VALUES ('a5100000-0000-0000-0000-0000000000a0', 'chat', 'a5100000-0000-0000-0000-000000000001');

-- Volající je SLUŽBA: reflect.ts volá fn_user_can_read_run přes rpcService
-- (service_role) s user_id z ověřeného PAT. Od 2026-09-19 funkce odpovídá o cizím
-- uuid jen službě a správě (predikát o třetí osobě = orákulum), takže bez těchto
-- claims by superuser bez JWT dostal false i pro vlastníka.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- OWNER may drain their own story's run (the unscoped/legacy poll fix path).
SELECT ok(
  public.fn_user_can_read_run('a5100000-0000-0000-0000-0000000000ee', 'a5100000-0000-0000-0000-0000000000a0'),
  'owner of the run''s story may read it (on-behalf-of)');

-- FOREIGN user (no story relationship, not admin) may NOT — no over-grant.
SELECT ok(
  NOT public.fn_user_can_read_run('a5100000-0000-0000-0000-0000000000ff', 'a5100000-0000-0000-0000-0000000000a0'),
  'foreign user may not read the run (no over-grant)');

-- UNKNOWN run id → false, identical to "not allowed" — fail-closed, no existence oracle.
SELECT ok(
  NOT public.fn_user_can_read_run('a5100000-0000-0000-0000-0000000000ee', 'a5100000-0000-0000-0000-00000000dead'),
  'unknown run id → false (fail-closed, no existence oracle)');

-- ORÁKULUM ZAVŘENÉ: přihlášený CIZÍ uživatel se přímým voláním /rpc nedozví,
-- zda vlastník smí běh číst (dřív true = vlastnictví cizí story). Odpověď se
-- měří pod rolí authenticated a uloží do GUC; ok() běží až po RESET ROLE, protože
-- pgTAP drží stav v dočasných tabulkách vlastníka relace.
SELECT set_config('request.jwt.claims',
  '{"sub":"a5100000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('rpa.cizi',
  public.fn_user_can_read_run('a5100000-0000-0000-0000-0000000000ee', 'a5100000-0000-0000-0000-0000000000a0')::text, true);
-- Vlastník sám za sebe — kontrolní vzorek (bez něj by false u cizího nic nedokazovalo).
SELECT set_config('request.jwt.claims',
  '{"sub":"a5100000-0000-0000-0000-0000000000ee","role":"authenticated"}', true);
SELECT set_config('rpa.sam',
  public.fn_user_can_read_run('a5100000-0000-0000-0000-0000000000ee', 'a5100000-0000-0000-0000-0000000000a0')::text, true);
RESET ROLE;

SELECT is(current_setting('rpa.cizi'), 'false',
  'foreign authenticated caller cannot learn the owner''s run access (no third-party oracle)');
SELECT is(current_setting('rpa.sam'), 'true',
  'owner asking about themself still gets the truth');

SELECT * FROM finish();
ROLLBACK;
