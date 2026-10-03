-- pgTAP schema-contract tests — validate_dose_proposal (advisory + member tier)
-- ============================================================================
-- Two tiers, one RPC:
--   PRODUCT tier (product, amount, unit): anon-friendly advisory bounds check.
--   MEMBER tier (+ member_distribution_plan_id): PHI access held to the dosing
--   access contract — auth + consultant/admin role + data-sharing consent +
--   audit — plus deviation warnings vs study protocol / member plan.
--
-- Asserts: product-tier behaviour (unchanged — no regression), the member-tier
-- access guard (auth / role / consent denials, admin consent-bypass), and that
-- the dose is still never blocked. Runs against the APPLIED (unseeded) cold-start
-- schema as superuser; member fixtures use session_replication_role=replica to
-- bypass FK/triggers. JWT identity is simulated via request.jwt.claims.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- ── Product fixtures (bounds: min 1, max 10, step .5) ────────────────────────
SELECT set_config('vdp.product', gen_random_uuid()::text, true);
INSERT INTO products (id, name, slug, price)
  VALUES (current_setting('vdp.product')::uuid, 'VDP test product', 'vdp-test-product', 9.99);
INSERT INTO dose_units (code, name_key, abbreviation_key)
  VALUES ('__vdp_unit__', 'dosing.units.__vdp_unit__', 'dosing.units.__vdp_unit___abbr');
INSERT INTO product_dose_units (product_id, dose_unit_code, default_amount, min_amount, max_amount, step_amount)
  VALUES (current_setting('vdp.product')::uuid, '__vdp_unit__', 2, 1, 10, 0.5);

-- ── Member-tier fixtures (parametric identities; FK/triggers off for seeding) ─
SELECT set_config('vdp.consultant', gen_random_uuid()::text, true);
SELECT set_config('vdp.admin',      gen_random_uuid()::text, true);
SELECT set_config('vdp.member',     gen_random_uuid()::text, true);
SELECT set_config('vdp.nonrole',    gen_random_uuid()::text, true);
SELECT set_config('vdp.plan',       gen_random_uuid()::text, true);
SELECT set_config('vdp.partner',    gen_random_uuid()::text, true);
SET session_replication_role = replica;
INSERT INTO aisha_auth.users (id) VALUES
  (current_setting('vdp.consultant')::uuid), (current_setting('vdp.admin')::uuid),
  (current_setting('vdp.member')::uuid),     (current_setting('vdp.nonrole')::uuid);
INSERT INTO user_roles (user_id, role) VALUES
  (current_setting('vdp.consultant')::uuid, 'consultant'::app_role),
  (current_setting('vdp.admin')::uuid,      'admin'::app_role);
-- The consultant IS a partner_profile; data-sharing consent links member → that
-- partner (has_data_sharing_consent JOINs partner_profiles ON pp.user_id=accessor).
INSERT INTO partner_profiles (id, user_id, display_name, city)
  VALUES (current_setting('vdp.partner')::uuid, current_setting('vdp.consultant')::uuid,
          'VDP test consultant', 'Testville');
INSERT INTO member_distribution_plans (id, user_id, dose_amount)
  VALUES (current_setting('vdp.plan')::uuid, current_setting('vdp.member')::uuid, 3);
SET session_replication_role = origin;

-- ── PRODUCT TIER (3-arg calls resolve to the 4-arg via DEFAULT NULL) ─────────
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='validate_dose_proposal' AND p.pronargs=4)
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='validate_dose_proposal' AND p.pronargs=3),
  'validate_dose_proposal: 4-arg member-aware signature exists; legacy 3-arg dropped'
);
SELECT is(
  (SELECT jsonb_array_length((validate_dose_proposal(current_setting('vdp.product')::uuid, 2, '__vdp_unit__'))->'warnings')),
  0, 'product tier: in-range, on-step dose yields zero warnings');
SELECT ok(
  (validate_dose_proposal(current_setting('vdp.product')::uuid, 2, '__vdp_unit__'))->>'product_unit_match' = 'true'
  AND ((validate_dose_proposal(current_setting('vdp.product')::uuid, 2, '__vdp_unit__'))->'recommended'->>'default_amount')::numeric = 2,
  'product tier: product_unit_match=true and recommended bounds returned');
SELECT ok(
  EXISTS (SELECT 1 FROM jsonb_array_elements(
    (validate_dose_proposal(current_setting('vdp.product')::uuid, 0.5, '__vdp_unit__'))->'warnings') w
    WHERE w->>'level'='low' AND w->>'context'='product_minimum'),
  'product tier: below-minimum dose emits a low warning');
SELECT ok(
  EXISTS (SELECT 1 FROM jsonb_array_elements(
    (validate_dose_proposal(current_setting('vdp.product')::uuid, 20, '__vdp_unit__'))->'warnings') w
    WHERE w->>'level'='high' AND w->>'context'='product_maximum'),
  'product tier: above-maximum dose emits a high warning');
SELECT ok(
  EXISTS (SELECT 1 FROM jsonb_array_elements(
    (validate_dose_proposal(current_setting('vdp.product')::uuid, 1.3, '__vdp_unit__'))->'warnings') w
    WHERE w->>'level'='info' AND w->>'context'='product_step_granularity'),
  'product tier: off-step dose emits an info (granularity) warning');
SELECT ok(
  ((validate_dose_proposal(current_setting('vdp.product')::uuid, 5, '__no_such_unit__'))->>'product_unit_match')::boolean IS FALSE
  AND (validate_dose_proposal(current_setting('vdp.product')::uuid, 5, '__no_such_unit__'))->'recommended' = 'null'::jsonb,
  'product tier: unknown product/unit → product_unit_match=false and recommended=null');
SELECT is(
  (SELECT (validate_dose_proposal(current_setting('vdp.product')::uuid, 0.5, '__vdp_unit__'))->>'valid'),
  'true', 'advisory: valid is always true (never blocks) even below minimum');

-- ── MEMBER TIER: access guard (auth → role → consent), then deviation ────────
-- (M1) anonymous / unauthenticated caller with member context → 42501
SELECT set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
SELECT throws_ok(
  $vdp$ SELECT validate_dose_proposal(current_setting('vdp.product')::uuid, 5, '__vdp_unit__',
          current_setting('vdp.plan')::uuid) $vdp$,
  '42501', NULL, '(M1) member tier: unauthenticated caller is denied (42501)');

-- (M2) authenticated but no consultant/admin role → 42501
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('vdp.nonrole'), 'role','authenticated')::text, true);
SELECT throws_ok(
  $vdp$ SELECT validate_dose_proposal(current_setting('vdp.product')::uuid, 5, '__vdp_unit__',
          current_setting('vdp.plan')::uuid) $vdp$,
  '42501', NULL, '(M2) member tier: non-consultant/non-admin is denied (42501)');

-- (M3) consultant WITHOUT data-sharing consent → 42501
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('vdp.consultant'), 'role','authenticated')::text, true);
SELECT throws_ok(
  $vdp$ SELECT validate_dose_proposal(current_setting('vdp.product')::uuid, 5, '__vdp_unit__',
          current_setting('vdp.plan')::uuid) $vdp$,
  '42501', NULL, '(M3) member tier: consultant without consent is denied (42501)');

-- grant data-sharing consent: member → the consultant's partner_profile
SET session_replication_role = replica;
INSERT INTO data_sharing_consents (user_id, partner_id)
  VALUES (current_setting('vdp.member')::uuid, current_setting('vdp.partner')::uuid);
SET session_replication_role = origin;

-- (M4) consultant WITH consent → allowed
SELECT lives_ok(
  $vdp$ SELECT validate_dose_proposal(current_setting('vdp.product')::uuid, 2, '__vdp_unit__',
          current_setting('vdp.plan')::uuid) $vdp$,
  '(M4) member tier: consultant with consent is allowed');

-- (M5) admin/staff → allowed without consent (platform operator bypass)
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('vdp.admin'), 'role','authenticated')::text, true);
SELECT lives_ok(
  $vdp$ SELECT validate_dose_proposal(current_setting('vdp.product')::uuid, 2, '__vdp_unit__',
          current_setting('vdp.plan')::uuid) $vdp$,
  '(M5) member tier: admin/staff is allowed (consent bypass)');

-- (M6) a dose differing from the member's plan (3) emits a member_plan_deviation
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('vdp.consultant'), 'role','authenticated')::text, true);
SELECT ok(
  EXISTS (SELECT 1 FROM jsonb_array_elements(
    (validate_dose_proposal(current_setting('vdp.product')::uuid, 7, '__vdp_unit__',
       current_setting('vdp.plan')::uuid))->'warnings') w
    WHERE w->>'context'='member_plan_deviation' AND (w->>'delta')::numeric = 4),
  '(M6) member tier: dose differing from the member plan emits a member_plan_deviation warning');

SELECT * FROM finish();
ROLLBACK;
