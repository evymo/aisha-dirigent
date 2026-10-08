/**
 * Gate: partner_profiles privilege-column write guard.
 *
 * audience_compute_actor_tier derives 'qualified' from partner_profiles.is_certified and
 * 'partner' from (is_visible AND is_production_provider). The self-update RLS policy has no
 * column restriction, so without this guard a member could PATCH their own row to
 * is_certified=true / is_production_provider=true and self-promote their audience tier.
 * This locks the guard: a BEFORE UPDATE trigger blocks non-admin changes to those two
 * columns, with a transaction-local sanctioned flag for the SECURITY DEFINER writer
 * (submit_partner_certification). is_visible stays user-controllable (not guarded).
 *
 * 2026-10-05 (revize 2, N2): the trigger was BEFORE UPDATE only — a signed-in user could INSERT
 * their own profile with is_certified = true (the insert policy checks only user_id). Guild G1,
 * the audience tier and validate_invitation all read that column. The guard now also covers
 * INSERT: an API client (any JWT role but service_role) may create a profile only with both
 * columns false (is_production_provider also via the sanctioned flag), otherwise 42501; admin/staff
 * and server contexts (service_role, no JWT) may. heals.sql replays the trigger file, so running
 * databases get the INSERT binding too. Behaviour: src/tests/db/partner-profil-privilegia.runtime.test.ts.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const GUARD = read('aisha/db/sql/functions/guard_partner_profile_privilege_columns.sql');
const TRIGGER = read('aisha/db/sql/triggers/partner_profiles_privilege_guard.sql');
const SUBMIT = read('aisha/db/sql/functions/submit_partner_certification.sql');

describe('partner_profiles privilege-column guard', () => {
  it('guard function blocks non-admin changes to is_certified and is_production_provider', () => {
    expect(GUARD).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_partner_profile_privilege_columns/);
    expect(GUARD).toMatch(/NEW\.is_certified IS DISTINCT FROM OLD\.is_certified[\s\S]{0,60}NOT v_is_admin/);
    expect(GUARD).toMatch(/NEW\.is_production_provider IS DISTINCT FROM OLD\.is_production_provider/);
    expect(GUARD).toMatch(/RAISE EXCEPTION[\s\S]{0,120}42501/);
  });

  it('is_certified is admin-only (the sanctioned flag does NOT cover it)', () => {
    // The flag guards only is_production_provider; is_certified has no server writer.
    const certBlock = GUARD.slice(GUARD.indexOf('is_certified'), GUARD.indexOf('is_production_provider'));
    expect(certBlock).not.toMatch(/v_sanctioned/);
    expect(GUARD).toMatch(/current_setting\('aisha\.partner_priv_write', true\) = 'on'/);
  });

  it('is_visible is NOT guarded (stays user-controllable directory visibility)', () => {
    expect(GUARD).not.toMatch(/NEW\.is_visible IS DISTINCT FROM OLD\.is_visible/);
  });

  it('a BEFORE INSERT OR UPDATE trigger binds the guard to partner_profiles (and heals replays it)', () => {
    expect(TRIGGER).toMatch(/BEFORE INSERT OR UPDATE ON public\.partner_profiles/);
    expect(TRIGGER).toMatch(/EXECUTE FUNCTION public\.guard_partner_profile_privilege_columns\(\)/);
    const heals = read('aisha/db/heals.sql');
    const fce = heals.indexOf('\\ir sql/functions/guard_partner_profile_privilege_columns.sql');
    const spoust = heals.indexOf('\\ir sql/triggers/partner_profiles_privilege_guard.sql');
    expect(fce, 'heals přehrává funkci guardu').toBeGreaterThan(-1);
    expect(spoust, 'heals přehrává spoušť guardu (INSERT dotekne do běžících databází)').toBeGreaterThan(fce);
  });

  it('INSERT by an API client: certified / provider profile only as admin (or sanctioned provider), else 42501', () => {
    const zac = GUARD.indexOf("IF TG_OP = 'INSERT' THEN");
    expect(zac, 'větev INSERT v guardu').toBeGreaterThan(-1);
    const ins = GUARD.slice(zac, GUARD.indexOf('RETURN NEW;\n  END IF;', zac));
    // Server context only for service_role and no JWT — any other JWT role is a client (fail-closed).
    expect(ins).toMatch(/v_is_admin OR v_jwt_role IS NULL OR v_jwt_role = 'service_role'/);
    expect(GUARD).toMatch(/v_jwt_role text := NULLIF\(public\.get_jwt_role\(\), ''\)/);
    // is_certified: no sanction may cover it on INSERT either.
    expect(ins).toMatch(/IF NEW\.is_certified IS TRUE THEN\s+RAISE EXCEPTION[\s\S]{0,200}42501/);
    expect(ins).toMatch(/IF NEW\.is_production_provider IS TRUE AND NOT v_sanctioned THEN\s+RAISE EXCEPTION[\s\S]{0,200}42501/);
    // No silent rewrite: the guard refuses, it does not set the column to false.
    expect(ins).not.toMatch(/NEW\.is_certified\s*:=/);
  });

  it('submit_partner_certification sets the sanctioned flag before writing the profile', () => {
    const flagAt = SUBMIT.indexOf("set_config('aisha.partner_priv_write', 'on', true)");
    const writeAt = SUBMIT.search(/INSERT INTO partner_profiles|UPDATE partner_profiles/);
    expect(flagAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(writeAt);
  });
});
