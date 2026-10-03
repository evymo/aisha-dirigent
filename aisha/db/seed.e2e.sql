-- ==============================================================================
-- E2E Test Seed: synthetic fixtures for the local Playwright E2E suite
-- ==============================================================================
-- Applied AFTER the compiled platform seed, as its own psql session
-- (ON_ERROR_STOP=1) by scripts/e2e/run-local.mjs, scripts/e2e/run-in-container.sh,
-- scripts/e2e/run-devstack.mjs and scripts/setup.sh. Must be idempotent: the
-- runners re-apply it on every run against a long-lived DB.
--
-- ⛔ The platform seed (aisha/db/seed/) carries NO project/demo data (owner
--    decision): no studies, test questions, packages, products, demo users or
--    stories. Everything a spec needs lives HERE, is obviously synthetic, and
--    never reuses an id or text of the removed project seed (no d0d0… ids).
--
-- Reserved id range — every fixture row uses a deterministic id of the form
--   e2e00000-0000-0000-0000-XXXXXXXXXXXX   (valid UUID text, hex digits only)
-- Specs reference them through e2e/fixture-ids.ts (single place, keep in sync):
--   …000000000001–004  users admin / member / partner / staff (+ profiles, roles)
--   …000000000010–199  member-owned rows (registration, check-ins, orders, …)
--   …000000000070      product            'e2e-test-product'
--   …000000000100      subscription pkg   'e2e-premium-monthly'
--   …000000000200      umbrella study     code 'e2e-umbrella'
--   …000000000201      consent template   code 'e2e_participation'
--   …000000000202      study consent requirement (umbrella → template)
--   …000000000210–213  test_questions, test_type 'qualification'
--   …000000000220–223  test_questions, test_type 'certification'
-- Translations for fixture keys use the key prefix 'e2e.' (locale en only; the
-- localized RPCs fall back to en).
--
-- Test users (Keycloak realm users provisioned by provision-e2e.sh):
--   - admin@platform.rtn   - Full admin access
--   - member@platform.rtn  - Regular member
--   - partner@platform.rtn - Production provider/practitioner
--   - staff@platform.rtn   - Limited admin staff

-- ============================================================================
-- SEED SETUP: the run's identity is DECLARED (same as seed/core/00_setup.sql).
-- This file runs in its own psql session, so the compiled seed's setting does
-- not carry over. is_local => false: the file is many statements/transactions.
-- ============================================================================
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('role', 'service_role')::text, false);
END $$;

-- Disable triggers that require auth.uid()
ALTER TABLE public.health_check_ins DISABLE TRIGGER update_streak_on_health_checkin;

-- ============================================================================
-- E2E TEST USERS: DB-side Keycloak anchors
-- ============================================================================
INSERT INTO aisha_auth.users (id, email, raw_user_meta_data, created_at, updated_at) VALUES
  ('e2e00000-0000-0000-0000-000000000001', 'admin@platform.rtn', '{"display_name":"E2E Admin User"}'::jsonb, NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000002', 'member@platform.rtn', '{"display_name":"E2E Member User"}'::jsonb, NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000003', 'partner@platform.rtn', '{"display_name":"E2E Partner User"}'::jsonb, NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000004', 'staff@platform.rtn', '{"display_name":"E2E Staff User"}'::jsonb, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data,
  updated_at = NOW();

INSERT INTO aisha_auth.identities (id, user_id, provider_id, identity_data, provider, email, created_at, updated_at, last_sign_in_at) VALUES
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-000000000001', jsonb_build_object('sub', 'e2e00000-0000-0000-0000-000000000001', 'email', 'admin@platform.rtn'), 'keycloak', 'admin@platform.rtn', NOW(), NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000002', 'e2e00000-0000-0000-0000-000000000002', 'e2e00000-0000-0000-0000-000000000002', jsonb_build_object('sub', 'e2e00000-0000-0000-0000-000000000002', 'email', 'member@platform.rtn'), 'keycloak', 'member@platform.rtn', NOW(), NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000003', 'e2e00000-0000-0000-0000-000000000003', 'e2e00000-0000-0000-0000-000000000003', jsonb_build_object('sub', 'e2e00000-0000-0000-0000-000000000003', 'email', 'partner@platform.rtn'), 'keycloak', 'partner@platform.rtn', NOW(), NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000004', 'e2e00000-0000-0000-0000-000000000004', 'e2e00000-0000-0000-0000-000000000004', jsonb_build_object('sub', 'e2e00000-0000-0000-0000-000000000004', 'email', 'staff@platform.rtn'), 'keycloak', 'staff@platform.rtn', NOW(), NOW(), NOW())
ON CONFLICT (provider, provider_id) DO UPDATE SET
  email = EXCLUDED.email,
  identity_data = EXCLUDED.identity_data,
  updated_at = NOW(),
  last_sign_in_at = EXCLUDED.last_sign_in_at;

INSERT INTO public.profiles (id, user_id, display_name, created_at, updated_at) VALUES
  ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-000000000001', 'E2E Admin User', NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000002', 'e2e00000-0000-0000-0000-000000000002', 'E2E Member User', NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000003', 'e2e00000-0000-0000-0000-000000000003', 'E2E Partner User', NOW(), NOW()),
  ('e2e00000-0000-0000-0000-000000000004', 'e2e00000-0000-0000-0000-000000000004', 'E2E Staff User', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  updated_at = NOW();

INSERT INTO public.user_roles (user_id, role, granted_by, granted_at) VALUES
  ('e2e00000-0000-0000-0000-000000000001', 'admin', 'e2e00000-0000-0000-0000-000000000001', NOW()),
  ('e2e00000-0000-0000-0000-000000000002', 'member', 'e2e00000-0000-0000-0000-000000000001', NOW()),
  ('e2e00000-0000-0000-0000-000000000003', 'practitioner', 'e2e00000-0000-0000-0000-000000000001', NOW()),
  ('e2e00000-0000-0000-0000-000000000004', 'staff', 'e2e00000-0000-0000-0000-000000000001', NOW())
ON CONFLICT (user_id, role) DO NOTHING;

-- Create partner profile for the practitioner
INSERT INTO public.partner_profiles (
  id,
  user_id,
  display_name,
  description,
  city,
  is_visible,
  is_production_provider,
  accepts_online_appointments,
  accepts_in_person_appointments,
  services,
  languages,
  -- Certified guild member — required for the agent-marketplace publish gate
  -- (submit_plugin / publish_agent check is_certified_partner).
  is_certified,
  certification_passed_at,
  certification_score,
  certification_level,
  created_at,
  updated_at
) VALUES (
  'e2e00000-0000-0000-0000-000000000003',
  'e2e00000-0000-0000-0000-000000000003',
  'E2E Partner User',
  'E2E test partner profile',
  'Prague',
  true,
  true,
  true,
  true,
  ARRAY['consultation', 'assessment'],
  ARRAY['cs', 'en'],
  true,
  NOW(),
  95,
  'certified_partner'::public.partner_certification_level,
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  display_name = 'E2E Partner User',
  city = 'Prague',
  accepts_online_appointments = true,
  accepts_in_person_appointments = true,
  is_certified = true,
  certification_passed_at = NOW(),
  certification_score = 95,
  certification_level = 'certified_partner'::public.partner_certification_level,
  updated_at = NOW();

-- ============================================================================
-- E2E: Synthetic umbrella study (the platform seed ships no studies)
-- ============================================================================
-- The app resolves "the" umbrella study by is_umbrella = true
-- (get_umbrella_study / useRIIMembership), never by id. studies has no natural
-- unique key besides the PK, so the deterministic id is the conflict target.
-- Slug deliberately does NOT match the data-factory cleanup ('e2e-test-%').
INSERT INTO public.studies (
  id,
  code,
  name,
  title,
  slug,
  description,
  study_type,
  status,
  is_umbrella,
  is_active,
  funding_status,
  informed_consent_version
) VALUES (
  'e2e00000-0000-0000-0000-000000000200',
  'e2e-umbrella',
  'E2E Umbrella Study',
  'E2E Umbrella Study',
  'e2e-fixture-umbrella-study',
  'Synthetic umbrella study for automated E2E tests.',
  'community'::public.study_type,
  'active'::public.study_status,
  true,
  true,
  'active',
  '1.0'
) ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  slug = EXCLUDED.slug,
  description = EXCLUDED.description,
  study_type = EXCLUDED.study_type,
  status = EXCLUDED.status,
  is_umbrella = EXCLUDED.is_umbrella,
  is_active = EXCLUDED.is_active,
  funding_status = EXCLUDED.funding_status,
  informed_consent_version = EXCLUDED.informed_consent_version;

-- One required consent for the umbrella study. StudyEnrollment cannot leave its
-- consent phase without at least one requirement (hasAllRequiredConsents is
-- false for an empty list). consent_type stays NULL: no consents-table side row.
INSERT INTO public.consent_templates (
  id,
  code,
  template_key,
  title_key,
  content_key,
  version,
  is_active,
  requires_signature,
  base_locale
) VALUES (
  'e2e00000-0000-0000-0000-000000000201',
  'e2e_participation',
  'e2e_participation',
  'e2e.consents.participation.title',
  'e2e.consents.participation.content',
  '1.0',
  true,
  false,
  'en'
) ON CONFLICT (code) DO UPDATE SET
  template_key = EXCLUDED.template_key,
  title_key = EXCLUDED.title_key,
  content_key = EXCLUDED.content_key,
  version = EXCLUDED.version,
  is_active = EXCLUDED.is_active,
  requires_signature = EXCLUDED.requires_signature,
  base_locale = EXCLUDED.base_locale;

INSERT INTO public.study_consent_requirements (
  id,
  study_id,
  consent_template_id,
  is_required,
  sort_order,
  display_order,
  is_active,
  consent_template_version
) VALUES (
  'e2e00000-0000-0000-0000-000000000202',
  'e2e00000-0000-0000-0000-000000000200',
  (SELECT id FROM public.consent_templates WHERE code = 'e2e_participation'),
  true,
  0,
  0,
  true,
  '1.0'
) ON CONFLICT (study_id, consent_template_id) DO UPDATE SET
  is_required = EXCLUDED.is_required,
  sort_order = EXCLUDED.sort_order,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active,
  consent_template_version = EXCLUDED.consent_template_version;

-- ============================================================================
-- E2E: Synthetic qualification + certification test questions
-- ============================================================================
-- validate_test_answers / submit_partner_certification grade ALL active
-- questions of a test_type (pass >= 75 %). The platform seed ships none, so
-- these are the complete sets; e2e/fixture-ids.ts holds the answer keys.
-- Options a–c are always set (the public RPC schema rejects a NULL option_c).
INSERT INTO public.test_questions (
  id,
  test_type,
  question_order,
  question,
  question_type,
  question_key,
  option_a_key,
  option_b_key,
  option_c_key,
  option_d_key,
  correct_answer,
  points,
  is_active
) VALUES
  ('e2e00000-0000-0000-0000-000000000210', 'qualification', 1, 'E2E qualification question 1', 'multiple_choice',
   'e2e.tests.qualification.1.question', 'e2e.tests.qualification.1.option_a', 'e2e.tests.qualification.1.option_b', 'e2e.tests.qualification.1.option_c', NULL, 'b', 1, true),
  ('e2e00000-0000-0000-0000-000000000211', 'qualification', 2, 'E2E qualification question 2', 'multiple_choice',
   'e2e.tests.qualification.2.question', 'e2e.tests.qualification.2.option_a', 'e2e.tests.qualification.2.option_b', 'e2e.tests.qualification.2.option_c', NULL, 'a', 1, true),
  ('e2e00000-0000-0000-0000-000000000212', 'qualification', 3, 'E2E qualification question 3', 'multiple_choice',
   'e2e.tests.qualification.3.question', 'e2e.tests.qualification.3.option_a', 'e2e.tests.qualification.3.option_b', 'e2e.tests.qualification.3.option_c', NULL, 'c', 1, true),
  ('e2e00000-0000-0000-0000-000000000213', 'qualification', 4, 'E2E qualification question 4', 'multiple_choice',
   'e2e.tests.qualification.4.question', 'e2e.tests.qualification.4.option_a', 'e2e.tests.qualification.4.option_b', 'e2e.tests.qualification.4.option_c', NULL, 'b', 1, true),
  ('e2e00000-0000-0000-0000-000000000220', 'certification', 1, 'E2E certification question 1', 'multiple_choice',
   'e2e.tests.certification.1.question', 'e2e.tests.certification.1.option_a', 'e2e.tests.certification.1.option_b', 'e2e.tests.certification.1.option_c', NULL, 'a', 1, true),
  ('e2e00000-0000-0000-0000-000000000221', 'certification', 2, 'E2E certification question 2', 'multiple_choice',
   'e2e.tests.certification.2.question', 'e2e.tests.certification.2.option_a', 'e2e.tests.certification.2.option_b', 'e2e.tests.certification.2.option_c', NULL, 'c', 1, true),
  ('e2e00000-0000-0000-0000-000000000222', 'certification', 3, 'E2E certification question 3', 'multiple_choice',
   'e2e.tests.certification.3.question', 'e2e.tests.certification.3.option_a', 'e2e.tests.certification.3.option_b', 'e2e.tests.certification.3.option_c', NULL, 'b', 1, true),
  ('e2e00000-0000-0000-0000-000000000223', 'certification', 4, 'E2E certification question 4', 'multiple_choice',
   'e2e.tests.certification.4.question', 'e2e.tests.certification.4.option_a', 'e2e.tests.certification.4.option_b', 'e2e.tests.certification.4.option_c', NULL, 'a', 1, true)
ON CONFLICT (id) DO UPDATE SET
  test_type = EXCLUDED.test_type,
  question_order = EXCLUDED.question_order,
  question = EXCLUDED.question,
  question_type = EXCLUDED.question_type,
  question_key = EXCLUDED.question_key,
  option_a_key = EXCLUDED.option_a_key,
  option_b_key = EXCLUDED.option_b_key,
  option_c_key = EXCLUDED.option_c_key,
  option_d_key = EXCLUDED.option_d_key,
  correct_answer = EXCLUDED.correct_answer,
  points = EXCLUDED.points,
  is_active = EXCLUDED.is_active;

-- ============================================================================
-- E2E: Translations for the fixture keys (namespaces the RPCs read)
-- ============================================================================
-- tests    ← get_test_questions_public_localized / _admin_localized
-- consents ← get_study_consent_requirements_localized
INSERT INTO public.translations (key, namespace, locale, value)
SELECT v.key, v.namespace, 'en', v.value
FROM (
  VALUES
    ('e2e.consents.participation.title', 'consents', 'E2E participation consent'),
    ('e2e.consents.participation.content', 'consents', 'Synthetic consent text used only by automated E2E tests.')
) AS v(key, namespace, value)
UNION ALL
SELECT format('e2e.tests.%s.%s.%s', q.test_type, q.n, f.field),
       'tests',
       'en',
       CASE f.field
         WHEN 'question' THEN format('E2E %s question %s', q.test_type, q.n)
         ELSE format('E2E %s question %s, option %s', q.test_type, q.n, upper(right(f.field, 1)))
       END
FROM (VALUES ('qualification'), ('certification')) AS t(test_type)
CROSS JOIN LATERAL (SELECT t.test_type, n FROM generate_series(1, 4) AS n) AS q
CROSS JOIN (VALUES ('question'), ('option_a'), ('option_b'), ('option_c')) AS f(field)
ON CONFLICT (key, namespace, locale) DO UPDATE SET
  value = EXCLUDED.value;

-- ============================================================================
-- E2E: Member registration into the synthetic umbrella study
-- ============================================================================
INSERT INTO public.study_registrations (
  id,
  user_id,
  study_id,
  status,
  enrolled_at,
  consultant_id,
  created_at,
  updated_at
) VALUES (
  'e2e00000-0000-0000-0000-000000000010',
  'e2e00000-0000-0000-0000-000000000002', -- member@platform.rtn
  'e2e00000-0000-0000-0000-000000000200', -- E2E Umbrella Study
  'active',
  NOW(),
  'e2e00000-0000-0000-0000-000000000003', -- partner@platform.rtn as consultant
  NOW(),
  NOW()
) ON CONFLICT (user_id, study_id) DO UPDATE SET
  status = 'active',
  consultant_id = EXCLUDED.consultant_id,
  updated_at = NOW();

-- ============================================================================
-- E2E: Health check-in for enrolled member (for sensitive data testing)
-- ============================================================================
INSERT INTO public.health_check_ins (
  id,
  user_id,
  check_in_date,
  pain_level,
  energy_level,
  mood_level,
  sleep_quality,
  notes,
  created_at
) VALUES (
  'e2e00000-0000-0000-0000-000000000011',
  'e2e00000-0000-0000-0000-000000000002', -- member@platform.rtn
  CURRENT_DATE,
  3,
  7,
  6,
  8,
  'E2E test health check-in',
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pain_level = 3,
  energy_level = 7;

-- ============================================================================
-- E2E: Data sharing consent (member -> partner)
-- ============================================================================
INSERT INTO public.data_sharing_consents (
  id,
  user_id,
  partner_id,
  consent_type,
  scope,
  granted_at,
  created_at
) VALUES (
  'e2e00000-0000-0000-0000-000000000012',
  'e2e00000-0000-0000-0000-000000000002', -- member@platform.rtn
  'e2e00000-0000-0000-0000-000000000003', -- partner profile ID
  'health_data',
  ARRAY['health_check_ins', 'lab_results', 'dosing_logs']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  scope = ARRAY['health_check_ins', 'lab_results', 'dosing_logs']::text[],
  granted_at = NOW();

-- ============================================================================
-- Permissions for E2E tests (practitioner needs view_partner_dashboard)
-- ============================================================================
INSERT INTO permissions (id, code, name, description, category, is_system)
VALUES 
  (gen_random_uuid(), 'view_partner_dashboard', 'View Partner Dashboard', 'Access partner dashboard', 'partner', true),
  (gen_random_uuid(), 'view_phi', 'View sensitive data', 'View protected health information', 'phi', true),
  (gen_random_uuid(), 'view_assigned_members', 'View Assigned Members', 'View members assigned to partner', 'partner', true)
ON CONFLICT (code) DO NOTHING;

-- Assign permissions to practitioner role
INSERT INTO app_role_permissions (role, permission_id, granted_by)
SELECT 'practitioner'::app_role, p.id, 'e2e00000-0000-0000-0000-000000000001'::uuid
FROM permissions p
WHERE p.code IN ('view_partner_dashboard', 'view_phi', 'view_assigned_members')
ON CONFLICT DO NOTHING;

-- Staff permissions (limited admin access)
INSERT INTO permissions (id, code, name, description, category, is_system)
VALUES 
  (gen_random_uuid(), 'view_admin_dashboard', 'View Admin Dashboard', 'Access admin dashboard', 'admin', true),
  (gen_random_uuid(), 'view_staff_dashboard', 'View Staff Dashboard', 'Access staff dashboard', 'admin', true)
ON CONFLICT (code) DO NOTHING;

-- Assign permissions to staff role
INSERT INTO app_role_permissions (role, permission_id, granted_by)
SELECT 'staff'::app_role, p.id, 'e2e00000-0000-0000-0000-000000000001'::uuid
FROM permissions p
WHERE p.code IN ('view_admin_dashboard', 'view_staff_dashboard', 'view_phi')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- E2E: Additional health check-ins for testing (secure mode, diary tests)
-- ============================================================================
INSERT INTO public.health_check_ins (
  id,
  user_id,
  check_in_date,
  pain_level,
  energy_level,
  mood_level,
  sleep_quality,
  sleep_hours,
  notes,
  symptoms,
  check_in_type,
  created_at
) VALUES
  -- Yesterday's check-in
  (
    'e2e00000-0000-0000-0000-000000000020',
    'e2e00000-0000-0000-0000-000000000002',
    CURRENT_DATE - INTERVAL '1 day',
    4,
    6,
    5,
    7,
    7.5,
    'E2E test - yesterday check-in',
    '{"joint_stiffness": true, "fatigue": false}'::jsonb,
    'morning',
    NOW() - INTERVAL '1 day'
  ),
  -- Two days ago
  (
    'e2e00000-0000-0000-0000-000000000021',
    'e2e00000-0000-0000-0000-000000000002',
    CURRENT_DATE - INTERVAL '2 days',
    5,
    5,
    6,
    6,
    6.5,
    'E2E test - 2 days ago',
    '{"joint_stiffness": true, "headache": true}'::jsonb,
    'morning',
    NOW() - INTERVAL '2 days'
  ),
  -- Week ago
  (
    'e2e00000-0000-0000-0000-000000000022',
    'e2e00000-0000-0000-0000-000000000002',
    CURRENT_DATE - INTERVAL '7 days',
    6,
    4,
    4,
    5,
    5.0,
    'E2E test - week ago',
    '{"joint_stiffness": true, "fatigue": true}'::jsonb,
    'morning',
    NOW() - INTERVAL '7 days'
  )
ON CONFLICT (id) DO UPDATE SET
  pain_level = EXCLUDED.pain_level,
  energy_level = EXCLUDED.energy_level;

-- ============================================================================
-- E2E: Dosing logs for product tracking tests
-- ============================================================================
INSERT INTO public.dosing_logs (
  id,
  user_id,
  dose_date,
  dose_time,
  dose_amount,
  dose_unit,
  dose_count,
  taken_with_food,
  notes,
  logged_at,
  created_at
) VALUES
  (
    'e2e00000-0000-0000-0000-000000000030',
    'e2e00000-0000-0000-0000-000000000002',
    CURRENT_DATE,
    '08:00:00',
    '5',
    'ml',
    1,
    true,
    'E2E test morning dose',
    NOW(),
    NOW()
  ),
  (
    'e2e00000-0000-0000-0000-000000000031',
    'e2e00000-0000-0000-0000-000000000002',
    CURRENT_DATE - INTERVAL '1 day',
    '08:30:00',
    '5',
    'ml',
    1,
    true,
    'E2E test yesterday dose',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (id) DO UPDATE SET
  dose_date = EXCLUDED.dose_date;

-- ============================================================================
-- E2E: Operational assessments for assessment tests
-- ============================================================================
INSERT INTO public.operational_assessments (
  id,
  user_id,
  status,
  assessment_type,
  overall_score,
  interpretation,
  started_at,
  completed_at,
  dimensions,
  created_at,
  updated_at
) VALUES
  -- Completed baseline assessment
  (
    'e2e00000-0000-0000-0000-000000000040',
    'e2e00000-0000-0000-0000-000000000002',
    'completed',
    'baseline',
    72.5,
    'Moderate symptoms with room for improvement',
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '30 days',
    '[{"name": "pain", "score": 65}, {"name": "mobility", "score": 70}, {"name": "quality_of_life", "score": 82}]'::jsonb,
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '30 days'
  ),
  -- In-progress follow-up assessment
  (
    'e2e00000-0000-0000-0000-000000000041',
    'e2e00000-0000-0000-0000-000000000002',
    'in_progress',
    'follow_up',
    NULL,
    NULL,
    NOW() - INTERVAL '1 hour',
    NULL,
    '[]'::jsonb,
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '1 hour'
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = NOW();

-- ============================================================================
-- E2E: Consent records for informed consent tests
-- ============================================================================
INSERT INTO public.consents (
  id,
  user_id,
  consent_type,
  version,
  granted,
  granted_at,
  ip_address,
  user_agent,
  created_at
) VALUES
  (
    'e2e00000-0000-0000-0000-000000000050',
    'e2e00000-0000-0000-0000-000000000002',
    'data_processing',
    '1.0',
    true,
    NOW() - INTERVAL '60 days',
    '127.0.0.1',
    'E2E Test Agent',
    NOW() - INTERVAL '60 days'
  ),
  (
    'e2e00000-0000-0000-0000-000000000051',
    'e2e00000-0000-0000-0000-000000000002',
    'marketing',
    '1.0',
    true,
    NOW() - INTERVAL '60 days',
    '127.0.0.1',
    'E2E Test Agent',
    NOW() - INTERVAL '60 days'
  ),
  (
    'e2e00000-0000-0000-0000-000000000052',
    'e2e00000-0000-0000-0000-000000000002',
    'wearables',
    '1.0',
    false,
    NULL,
    '127.0.0.1',
    'E2E Test Agent',
    NOW() - INTERVAL '60 days'
  )
ON CONFLICT (user_id, consent_type) WHERE study_id IS NULL DO UPDATE SET
  id = EXCLUDED.id,
  version = EXCLUDED.version,
  granted = EXCLUDED.granted,
  granted_at = EXCLUDED.granted_at,
  ip_address = EXCLUDED.ip_address,
  user_agent = EXCLUDED.user_agent;

-- ============================================================================
-- E2E: Token allocations and transactions for gamification tests
-- ============================================================================
INSERT INTO public.token_allocations (
  id,
  user_id,
  allocation_name,
  allocation_type,
  token_type,
  total_amount,
  distributed_amount,
  balance,
  current_streak,
  best_streak,
  last_activity_date,
  is_active,
  updated_at
) VALUES
  (
    'e2e00000-0000-0000-0000-000000000060',
    'e2e00000-0000-0000-0000-000000000002',
    'E2E Member Rewards',
    'member_rewards',
    'PLATFORM',
    1000.00000000,
    250.00000000,
    750.00000000,
    5,
    12,
    CURRENT_DATE,
    true,
    NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  balance = EXCLUDED.balance,
  current_streak = EXCLUDED.current_streak,
  updated_at = NOW();

INSERT INTO public.token_transactions (
  id,
  user_id,
  to_user_id,
  amount,
  transaction_type,
  reference_type,
  description,
  token_type,
  balance_after,
  created_at
) VALUES
  (
    'e2e00000-0000-0000-0000-000000000061',
    'e2e00000-0000-0000-0000-000000000002',
    'e2e00000-0000-0000-0000-000000000002',
    50.00000000,
    'reward',
    'check_in',
    'Daily check-in reward',
    'PLATFORM',
    800.00000000,
    NOW() - INTERVAL '1 day'
  ),
  (
    'e2e00000-0000-0000-0000-000000000062',
    'e2e00000-0000-0000-0000-000000000002',
    'e2e00000-0000-0000-0000-000000000002',
    100.00000000,
    'reward',
    'streak_bonus',
    '5-day streak bonus',
    'PLATFORM',
    750.00000000,
    NOW()
  ),
  (
    'e2e00000-0000-0000-0000-000000000063',
    'e2e00000-0000-0000-0000-000000000002',
    NULL,
    -50.00000000,
    'spend',
    'shop_discount',
    'Shop discount redemption',
    'PLATFORM',
    700.00000000,
    NOW() - INTERVAL '7 days'
  )
ON CONFLICT (id) DO UPDATE SET
  amount = EXCLUDED.amount;

-- ============================================================================
-- E2E: Orders for checkout flow tests
-- ============================================================================
-- First, ensure we have a product to reference
INSERT INTO public.products (
  id,
  name,
  slug,
  description,
  price,
  is_active,
  stock_quantity,
  created_at,
  updated_at
) VALUES (
  'e2e00000-0000-0000-0000-000000000070',
  'E2E Test Product',
  'e2e-test-product',
  'Test product for E2E checkout tests',
  299.00,
  true,
  100,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  is_active = EXCLUDED.is_active,
  stock_quantity = EXCLUDED.stock_quantity;

-- Pending order (cart state)
INSERT INTO public.orders (
  id,
  user_id,
  status,
  total,
  subtotal,
  tax,
  shipping,
  currency,
  shipping_address,
  payment_status,
  shipping_method,
  created_at,
  updated_at
) VALUES
  (
    'e2e00000-0000-0000-0000-000000000071',
    'e2e00000-0000-0000-0000-000000000002',
    'pending',
    348.00,
    299.00,
    0.00,
    49.00,
    'CZK',
    '{"name": "E2E Test User", "street": "Test Street 123", "city": "Prague", "postal_code": "11000", "country": "CZ"}'::jsonb,
    'pending',
    'packeta_pickup',
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '1 hour'
  ),
  -- Completed order (for order history)
  (
    'e2e00000-0000-0000-0000-000000000072',
    'e2e00000-0000-0000-0000-000000000002',
    'delivered',
    597.00,
    499.00,
    0.00,
    98.00,
    'CZK',
    '{"name": "E2E Test User", "street": "Test Street 123", "city": "Prague", "postal_code": "11000", "country": "CZ"}'::jsonb,
    'paid',
    'packeta_home',
    NOW() - INTERVAL '14 days',
    NOW() - INTERVAL '10 days'
  ),
  -- Processing order
  (
    'e2e00000-0000-0000-0000-000000000073',
    'e2e00000-0000-0000-0000-000000000002',
    'processing',
    348.00,
    299.00,
    0.00,
    49.00,
    'CZK',
    '{"name": "E2E Test User", "street": "Test Street 123", "city": "Prague", "postal_code": "11000", "country": "CZ"}'::jsonb,
    'paid',
    'packeta_pickup',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = NOW();

-- Order items
INSERT INTO public.order_items (
  id,
  order_id,
  product_id,
  quantity,
  price_at_purchase,
  created_at
) VALUES
  (
    'e2e00000-0000-0000-0000-000000000074',
    'e2e00000-0000-0000-0000-000000000071',
    'e2e00000-0000-0000-0000-000000000070',
    1,
    299.00,
    NOW() - INTERVAL '1 hour'
  ),
  (
    'e2e00000-0000-0000-0000-000000000075',
    'e2e00000-0000-0000-0000-000000000072',
    'e2e00000-0000-0000-0000-000000000070',
    1,
    499.00,
    NOW() - INTERVAL '14 days'
  ),
  (
    'e2e00000-0000-0000-0000-000000000076',
    'e2e00000-0000-0000-0000-000000000073',
    'e2e00000-0000-0000-0000-000000000070',
    1,
    299.00,
    NOW() - INTERVAL '2 days'
  )
ON CONFLICT (id) DO UPDATE SET
  quantity = EXCLUDED.quantity;

-- ============================================================================
-- E2E: Appointments for booking tests
-- ============================================================================
INSERT INTO public.partner_appointments (
  id,
  partner_id,
  member_id,
  scheduled_at,
  duration_minutes,
  status,
  type,
  appointment_type,
  notes,
  appointment_date,
  start_time,
  end_time,
  created_at,
  updated_at
) VALUES
  -- Upcoming appointment
  (
    'e2e00000-0000-0000-0000-000000000080',
    'e2e00000-0000-0000-0000-000000000003',
    'e2e00000-0000-0000-0000-000000000002',
    NOW() + INTERVAL '3 days',
    30,
    'scheduled',
    'consultation',
    'initial_consultation',
    'E2E test - upcoming appointment',
    (CURRENT_DATE + INTERVAL '3 days')::date,
    '10:00:00',
    '10:30:00',
    NOW(),
    NOW()
  ),
  -- Past completed appointment
  (
    'e2e00000-0000-0000-0000-000000000081',
    'e2e00000-0000-0000-0000-000000000003',
    'e2e00000-0000-0000-0000-000000000002',
    NOW() - INTERVAL '7 days',
    45,
    'completed',
    'follow_up',
    'follow_up',
    'E2E test - completed appointment',
    (CURRENT_DATE - INTERVAL '7 days')::date,
    '14:00:00',
    '14:45:00',
    NOW() - INTERVAL '14 days',
    NOW() - INTERVAL '7 days'
  ),
  -- Cancelled appointment
  (
    'e2e00000-0000-0000-0000-000000000082',
    'e2e00000-0000-0000-0000-000000000003',
    'e2e00000-0000-0000-0000-000000000002',
    NOW() - INTERVAL '2 days',
    30,
    'cancelled',
    'consultation',
    'consultation',
    'E2E test - cancelled appointment',
    (CURRENT_DATE - INTERVAL '2 days')::date,
    '11:00:00',
    '11:30:00',
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '3 days'
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = NOW();

-- ============================================================================
-- E2E: Partner availability slots for appointment booking
-- ============================================================================
-- Check if partner_availability table exists and insert
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'partner_availability') THEN
    INSERT INTO public.partner_availability (
      id,
      partner_id,
      day_of_week,
      start_time,
      end_time,
      is_available,
      created_at
    ) VALUES
      ('e2e00000-0000-0000-0000-000000000090', 'e2e00000-0000-0000-0000-000000000003', 1, '09:00:00', '17:00:00', true, NOW()),
      ('e2e00000-0000-0000-0000-000000000091', 'e2e00000-0000-0000-0000-000000000003', 2, '09:00:00', '17:00:00', true, NOW()),
      ('e2e00000-0000-0000-0000-000000000092', 'e2e00000-0000-0000-0000-000000000003', 3, '09:00:00', '17:00:00', true, NOW()),
      ('e2e00000-0000-0000-0000-000000000093', 'e2e00000-0000-0000-0000-000000000003', 4, '09:00:00', '17:00:00', true, NOW()),
      ('e2e00000-0000-0000-0000-000000000094', 'e2e00000-0000-0000-0000-000000000003', 5, '09:00:00', '13:00:00', true, NOW())
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- E2E: Subscription packages and member subscriptions
-- ============================================================================
-- First ensure we have a subscription package
INSERT INTO public.subscription_packages (
  id,
  name,
  slug,
  description,
  price,
  currency,
  billing_interval_months,
  features,
  is_active,
  created_at,
  updated_at
) VALUES (
  'e2e00000-0000-0000-0000-000000000100',
  'E2E Premium Monthly',
  'e2e-premium-monthly',
  'E2E test subscription package',
  999.00,
  'CZK',
  1,
  '["Unlimited check-ins", "Priority support", "Advanced analytics"]'::jsonb,
  true,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  billing_interval_months = EXCLUDED.billing_interval_months,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active;

-- Member subscription
INSERT INTO public.member_subscriptions (
  id,
  user_id,
  package_id,
  status,
  started_at,
  period_start,
  period_end,
  amount_paid,
  currency,
  billing_interval_months,
  cancel_at_period_end,
  next_billing_date,
  payment_type,
  created_at
) VALUES (
  'e2e00000-0000-0000-0000-000000000101',
  'e2e00000-0000-0000-0000-000000000002',
  'e2e00000-0000-0000-0000-000000000100',
  'active',
  NOW() - INTERVAL '15 days',
  NOW() - INTERVAL '15 days',
  NOW() + INTERVAL '15 days',
  999.00,
  'CZK',
  1,
  false,
  NOW() + INTERVAL '15 days',
  'recurring',
  NOW() - INTERVAL '15 days'
) ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  period_end = EXCLUDED.period_end;

-- ============================================================================
-- E2E: Member health states for health log tests
-- ============================================================================
-- Insert health states if table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'member_health_states') THEN
    INSERT INTO public.member_health_states (
      id,
      user_id,
      name_key,
      custom_name,
      severity_scale,
      is_active,
      created_at
    ) VALUES
      ('e2e00000-0000-0000-0000-000000000110', 'e2e00000-0000-0000-0000-000000000002', 'joint_pain', 'Joint Pain', 10, true, NOW()),
      ('e2e00000-0000-0000-0000-000000000111', 'e2e00000-0000-0000-0000-000000000002', 'fatigue', 'Fatigue', 10, true, NOW()),
      ('e2e00000-0000-0000-0000-000000000112', 'e2e00000-0000-0000-0000-000000000002', 'headache', 'Headache', 10, true, NOW())
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- E2E: AI Agent configurations for admin tests
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ai_agents') THEN
    INSERT INTO public.ai_agents (
      id,
      name,
      description,
      agent_type,
      model,
      system_prompt,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      'e2e00000-0000-0000-0000-000000000120',
      'E2E Test Agent',
      'Test AI agent for E2E testing',
      'storyloop',
      'gpt-4',
      'You are a helpful health assistant.',
      true,
      NOW(),
      NOW()
    ) ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      is_active = EXCLUDED.is_active;
  END IF;
END $$;

-- ============================================================================
-- E2E: Distribution protocols for admin tests
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'distribution_protocols') THEN
    INSERT INTO public.distribution_protocols (
      id,
      name,
      description,
      dose_amount,
      dose_unit,
      doses_per_day,
      dose_timing,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      'e2e00000-0000-0000-0000-000000000130',
      'E2E Standard Protocol',
      'Standard distribution protocol for E2E testing',
      5.0,
      'ml',
      1,
      ARRAY['morning'],
      true,
      NOW(),
      NOW()
    ) ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      is_active = EXCLUDED.is_active;
  END IF;
END $$;

-- ============================================================================
-- E2E: Biomarker definitions for admin tests
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'biomarker_definitions') THEN
    INSERT INTO public.biomarker_definitions (
      id,
      code,
      name,
      name_cs,
      unit,
      reference_min,
      reference_max,
      is_active,
      created_at,
      updated_at
    ) VALUES
      ('e2e00000-0000-0000-0000-000000000140', 'CRP', 'C-Reactive Protein', 'C-reaktivní protein', 'mg/L', 0.0, 10.0, true, NOW(), NOW()),
      ('e2e00000-0000-0000-0000-000000000141', 'ESR', 'Erythrocyte Sedimentation Rate', 'Sedimentace', 'mm/h', 0.0, 20.0, true, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- SEED CLEANUP: Re-enable triggers disabled at start
-- ============================================================================
ALTER TABLE public.health_check_ins ENABLE TRIGGER update_streak_on_health_checkin;

-- ============================================================================
-- Verify the fixtures the specs depend on — FAIL LOUD (runners use ON_ERROR_STOP)
-- ============================================================================
DO $$
DECLARE
  c_umbrella CONSTANT uuid := 'e2e00000-0000-0000-0000-000000000200';
  c_member   CONSTANT uuid := 'e2e00000-0000-0000-0000-000000000002';
  v_users integer;
  v_umbrella uuid;
  v_registrations integer;
  v_consents integer;
  v_fixture_questions integer;
  v_active_questions integer;
  v_untranslated integer;
  v_packages integer;
  v_products integer;
  v_test_type text;
BEGIN
  SELECT count(*) INTO v_users
  FROM aisha_auth.users
  WHERE id IN ('e2e00000-0000-0000-0000-000000000001', 'e2e00000-0000-0000-0000-000000000002',
               'e2e00000-0000-0000-0000-000000000003', 'e2e00000-0000-0000-0000-000000000004');
  IF v_users <> 4 THEN
    RAISE EXCEPTION 'E2E seed: % of 4 test users present', v_users;
  END IF;

  -- The app picks the umbrella study by flag, not by id: the fixture must be the one it gets.
  SELECT u.id INTO v_umbrella FROM public.get_umbrella_study() AS u LIMIT 1;
  IF v_umbrella IS DISTINCT FROM c_umbrella THEN
    RAISE EXCEPTION 'E2E seed: get_umbrella_study() returns %, expected the fixture %', v_umbrella, c_umbrella;
  END IF;

  SELECT count(*) INTO v_registrations
  FROM public.study_registrations
  WHERE user_id = c_member AND study_id = c_umbrella AND status = 'active';
  IF v_registrations <> 1 THEN
    RAISE EXCEPTION 'E2E seed: member has % active umbrella registration(s), expected 1', v_registrations;
  END IF;

  SELECT count(*) INTO v_consents
  FROM public.get_study_consent_requirements_localized(c_umbrella, 'en') AS r
  WHERE r.is_required AND r.title = 'E2E participation consent';
  IF v_consents <> 1 THEN
    RAISE EXCEPTION 'E2E seed: umbrella study has % localized required fixture consent(s), expected 1', v_consents;
  END IF;

  FOREACH v_test_type IN ARRAY ARRAY['qualification', 'certification'] LOOP
    SELECT count(*) FILTER (WHERE id::text LIKE 'e2e00000-%'), count(*)
      INTO v_fixture_questions, v_active_questions
    FROM public.test_questions
    WHERE test_type = v_test_type AND is_active;
    IF v_fixture_questions <> 4 THEN
      RAISE EXCEPTION 'E2E seed: % active fixture % question(s), expected 4', v_fixture_questions, v_test_type;
    END IF;
    IF v_active_questions > v_fixture_questions THEN
      -- Grading counts ALL active questions; a long-lived DB with other questions
      -- makes the fixture answer key insufficient. Not ours to deactivate — say it.
      RAISE WARNING 'E2E seed: % non-fixture active % question(s) present — onboarding answer key will not reach the pass mark',
        v_active_questions - v_fixture_questions, v_test_type;
    END IF;

    SELECT count(*) INTO v_untranslated
    FROM jsonb_array_elements(public.get_test_questions_public_localized('en', v_test_type)) AS q
    WHERE q->>'id' LIKE 'e2e00000-%'
      AND (q->>'question' IS NULL OR q->>'option_a' IS NULL OR q->>'option_b' IS NULL OR q->>'option_c' IS NULL);
    IF v_untranslated <> 0 THEN
      RAISE EXCEPTION 'E2E seed: % fixture % question(s) lack en translations', v_untranslated, v_test_type;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_packages
  FROM public.subscription_packages WHERE slug = 'e2e-premium-monthly' AND is_active;
  SELECT count(*) INTO v_products
  FROM public.products WHERE slug = 'e2e-test-product' AND is_active;
  IF v_packages <> 1 OR v_products <> 1 THEN
    RAISE EXCEPTION 'E2E seed: fixture package/product missing (packages=%, products=%)', v_packages, v_products;
  END IF;

  RAISE NOTICE 'E2E seed: fixtures verified (4 users, umbrella %, 4+4 test questions, package, product)', c_umbrella;
END $$;
