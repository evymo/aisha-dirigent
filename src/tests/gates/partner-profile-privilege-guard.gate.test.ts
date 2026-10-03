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

  it('a BEFORE UPDATE trigger binds the guard to partner_profiles', () => {
    expect(TRIGGER).toMatch(/BEFORE UPDATE ON public\.partner_profiles/);
    expect(TRIGGER).toMatch(/EXECUTE FUNCTION public\.guard_partner_profile_privilege_columns\(\)/);
  });

  it('submit_partner_certification sets the sanctioned flag before writing the profile', () => {
    const flagAt = SUBMIT.indexOf("set_config('aisha.partner_priv_write', 'on', true)");
    const writeAt = SUBMIT.search(/INSERT INTO partner_profiles|UPDATE partner_profiles/);
    expect(flagAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(writeAt);
  });
});
