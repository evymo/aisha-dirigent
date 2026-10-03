-- ==============================================================================
-- PostgreSQL Seed: Core reference data (PROD-SAFE)
-- ==============================================================================
-- This file is applied manually via `npm run db:seed`.
--
-- IMPORTANT:

-- ============================================================================
-- SEED SETUP: identita běhu se DEKLARUJE
-- ============================================================================
-- Seed zapisuje jménem systému, ne jménem člověka — proto se prohlásí za
-- `service_role`. Do 2026-08-04 to nedělal a přesto procházel: deny-guardy
-- porovnávaly claims inline, `current_setting('request.jwt.claims', true)` bez
-- claims vrací NULL a `NOT NULL` je NULL, takže se `RAISE` nikdy neprovedl.
-- Seed tedy neběžel s oprávněním — běžel skrz DÍRU (fail-open).
--
-- Jakmile guardy začaly číst roli přes `public.is_service_role()` (COALESCE →
-- false, guard je totální), zastavil se cold-start hned na
-- `ensure_stack_default_story()` v CORE vrstvě. To není regrese opravy, to je
-- ta oprava, jak se projeví: co dřív prošlo mlčky, teď musí mít identitu.
--
-- `is_local => false`: seed je JEDNA psql session s mnoha transakcemi;
-- transakčně lokální nastavení by po prvním COMMITu zmizelo.
SELECT set_config('request.jwt.claims',
                  json_build_object('role', 'service_role')::text, false);

-- ============================================================================
-- STEP 0: Seed Admin User (for created_by references)
-- ============================================================================
-- Create a system/seed admin user for references that require created_by
-- Email: seed-admin@platform.local

INSERT INTO aisha_auth.users (
  id,
  email,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'seed-admin@platform.local',
  '{"display_name":"Seed Admin","is_system_user":true}',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO aisha_auth.identities (
  id,
  user_id,
  provider,
  provider_id,
  email,
  identity_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'keycloak',
  '00000000-0000-0000-0000-000000000001',
  'seed-admin@platform.local',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'email', 'seed-admin@platform.local'),
  NOW(),
  NOW()
) ON CONFLICT (provider, provider_id) DO UPDATE SET
  email = EXCLUDED.email,
  identity_data = EXCLUDED.identity_data,
  updated_at = NOW();

-- Also create profile for the seed admin
INSERT INTO public.profiles (id, user_id, display_name, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Seed Admin',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Grant admin role to seed admin
INSERT INTO public.user_roles (user_id, role, granted_by, granted_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin',
  '00000000-0000-0000-0000-000000000001',
  NOW()
) ON CONFLICT (user_id, role) DO NOTHING;

-- ============================================================================
-- STEP 0b: Stack-default story — the §16/§20 "every run carries a story" anchor.
-- ============================================================================
-- Internal/system ai_runs (reflection orchestration, agent live sessions, trace
-- events) carry no USER story. To uphold the ai_runs.story_id NOT NULL invariant
-- (chargeback/RLS/audit) WITHOUT each internal run inventing a story, they bind to
-- the singleton STACK-DEFAULT story — the stack's OWN governance story
-- (is_stack_default=true). The BEFORE INSERT trigger ai_runs_default_story
-- (fn_ai_runs_default_story) resolves it; the participant_read_* RLS policies already key on is_stack_default.
-- Ensured here in CORE via the canonical ensure_stack_default_story() so it is
-- present in EVERY database (demo/cold-start included), not only the instance layer.
SELECT public.ensure_stack_default_story();

-- ============================================================================
-- STEP 0c: Kotvy funkcí platformy — dotazníky, na které se aplikace odkazuje id
-- ============================================================================
-- src/lib/studyRegistrationSchema.ts drží napevno STUDY_ENROLLMENT_QUESTIONNAIRE_ID
-- (…0001) a QUALIFICATION_TEST_QUESTIONNAIRE_ID (…0002). Jsou to obecné kotvy
-- registrace do studie a kvalifikačního testu — obsah (otázky, testy) si dodá
-- instance. Projektové dotazníky (INTAKE, WOMAC, WEEKLY …) do platformy nepatří.
INSERT INTO public.questionnaires (
  id, name, code, questionnaire_type, questions, is_active, created_at, version,
  name_key, description_key, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Study Registration Questionnaire', 'study-registration', 'registration', '{"sections":["basic_info","current_state","background_info","preferences"]}', true, '2025-12-08 13:45:39.700271+00', 1, 'study-registration.name', 'study-registration.description', '2025-12-08 13:45:39.700271+00'),
  ('00000000-0000-0000-0000-000000000002', 'Qualification Test Results', 'QUALIFICATION-TEST', 'test', '{"type":"test_results"}', true, '2025-12-14 03:48:00.181815+00', 1, 'QUALIFICATION-TEST.name', 'QUALIFICATION-TEST.description', '2025-12-14 03:48:00.181815+00')
ON CONFLICT (id) DO NOTHING;
