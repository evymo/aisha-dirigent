-- pgTAP schema-contract tests — partner_profiles privilege-column write guard
-- ============================================================================
-- audience_compute_actor_tier derives 'qualified' from is_certified and 'partner' from
-- (is_visible AND is_production_provider). The self-update RLS policy has no column
-- restriction, so the partner_profiles_privilege_guard BEFORE UPDATE trigger is what
-- stops a member self-escalating. Proven here (unseeded, rolled-back txn):
--   * a non-admin cannot change is_certified or is_production_provider on their own row;
--   * is_visible stays user-controllable (not guarded);
--   * the sanctioned transaction-local flag (set by submit_partner_certification) lets
--     is_production_provider through, but NOT is_certified (admin-only);
--   * admin/staff may change is_certified.
-- auth.uid()/roles are simulated via request.jwt.claims (sub) + user_roles.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

SELECT set_config('t.member', gen_random_uuid()::text, true);
SELECT set_config('t.admin',  gen_random_uuid()::text, true);

INSERT INTO aisha_auth.users (id)
  VALUES (current_setting('t.member')::uuid), (current_setting('t.admin')::uuid);
-- handle_new_user() provisions a profile on insert into aisha_auth.users, so by
-- the time we get here the rows may already exist. What this test needs is that
-- the two users HAVE profiles, not that this statement created them.
INSERT INTO profiles (user_id)
  VALUES (current_setting('t.member')::uuid), (current_setting('t.admin')::uuid)
  ON CONFLICT (user_id) DO NOTHING;
INSERT INTO user_roles (user_id, role)
  VALUES (current_setting('t.admin')::uuid, 'admin');
INSERT INTO partner_profiles (user_id, display_name, city, is_visible, is_production_provider, is_certified)
  VALUES (current_setting('t.member')::uuid, 'Member', 'City', true, false, false);

-- ── Act as the (non-admin) member ───────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.member'), 'role', 'authenticated')::text, true);

SELECT throws_ok(
  $g$ UPDATE partner_profiles SET is_certified = true WHERE user_id = current_setting('t.member')::uuid $g$,
  '42501', NULL, 'member cannot self-set is_certified (would self-promote to qualified)');

SELECT throws_ok(
  $g$ UPDATE partner_profiles SET is_production_provider = true WHERE user_id = current_setting('t.member')::uuid $g$,
  '42501', NULL, 'member cannot self-set is_production_provider (would self-promote to partner)');

SELECT lives_ok(
  $g$ UPDATE partner_profiles SET is_visible = false WHERE user_id = current_setting('t.member')::uuid $g$,
  'member CAN change own is_visible (directory visibility is user-controllable)');

-- ── Sanctioned definer path (what submit_partner_certification does) ─────────
SELECT set_config('aisha.partner_priv_write', 'on', true);

SELECT lives_ok(
  $g$ UPDATE partner_profiles SET is_production_provider = true WHERE user_id = current_setting('t.member')::uuid $g$,
  'sanctioned flag allows is_production_provider write');

SELECT throws_ok(
  $g$ UPDATE partner_profiles SET is_certified = true WHERE user_id = current_setting('t.member')::uuid $g$,
  '42501', NULL, 'the flag does NOT sanction is_certified (admin-only)');

SELECT set_config('aisha.partner_priv_write', 'off', true);

-- ── Act as admin ────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

SELECT lives_ok(
  $g$ UPDATE partner_profiles SET is_certified = true WHERE user_id = current_setting('t.member')::uuid $g$,
  'admin/staff may change is_certified');

SELECT * FROM finish();
ROLLBACK;
