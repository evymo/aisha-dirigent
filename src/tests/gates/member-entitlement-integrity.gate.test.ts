/**
 * Gate: member entitlement integrity.
 *
 * Locks the qualified-marker + subscription->membership bridge against regression:
 *  - qualification is server-authored evidence (qualification_results), not client-
 *    forgeable — clients hold no INSERT/UPDATE/DELETE grant, and is_qualified() reads it;
 *  - partner_certifications is likewise read-only to clients;
 *  - subscription pricing is server-authoritative (from the package, not the client);
 *  - membership tier checks use the real enum ('upgraded'), not the dead 'premium'/'vip';
 *  - activating a subscription bridges the tier onto memberships;
 *  - create_membership cannot be used to self-grant a paid tier.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

/** Strip full-line SQL comments so prose like "no INSERT/UPDATE/DELETE" can't match a grant regex. */
const code = (s: string): string => s.replace(/^[ \t]*--.*$/gm, '');

const ASSIGN = read('aisha/db/sql/functions/assign_member_role_after_qualification.sql');
const IS_QUALIFIED = read('aisha/db/sql/functions/is_qualified.sql');
const QR_GRANTS = read('aisha/db/sql/grants/qualification_results.sql');
const PC_GRANTS = read('aisha/db/sql/grants/partner_certifications.sql');
const CREATE_SUB = read('aisha/db/sql/functions/create_subscription_request.sql');
const PROD_ACCESS = read('aisha/db/sql/functions/get_product_access_type.sql');
const CHAT_ACCESS = read('aisha/db/sql/functions/get_chat_access_level.sql');
const ACTIVATE = read('aisha/db/sql/functions/update_member_subscription_status_admin.sql');
const CREATE_MEMBERSHIP = read('aisha/db/sql/functions/create_membership.sql');

describe('qualified marker is server-authored & non-forgeable', () => {
  it('assign_member_role_after_qualification writes qualification_results', () => {
    expect(ASSIGN).toMatch(/INSERT INTO public\.qualification_results/);
  });
  it('is_qualified() reads a passing qualification_results row (guarded cross-user)', () => {
    expect(IS_QUALIFIED).toMatch(/FROM public\.qualification_results/);
    expect(IS_QUALIFIED).toMatch(/qr\.passed = true/);
    expect(IS_QUALIFIED).toMatch(/is_service_role\(\) OR public\.is_admin_or_staff/);
  });
  it('clients cannot write the evidence tables (SELECT-own only)', () => {
    // Comment-stripped: only real GRANT statements are considered.
    expect(code(QR_GRANTS)).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO authenticated/);
    expect(QR_GRANTS).toMatch(/GRANT SELECT ON public\.qualification_results TO authenticated/);
    expect(code(PC_GRANTS)).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO authenticated/);
    expect(PC_GRANTS).toMatch(/GRANT SELECT ON public\.partner_certifications TO authenticated/);
  });
});

describe('subscription -> membership bridge', () => {
  it('create_subscription_request prices from the package, not the client', () => {
    expect(CREATE_SUB).toMatch(/v_amount := v_pkg\.price/);
    expect(CREATE_SUB).toMatch(/NOT FOUND OR NOT v_pkg\.is_active/);
  });
  it('membership tier checks use the real enum (no dead premium/vip)', () => {
    expect(PROD_ACCESS).toMatch(/v_membership_tier = 'upgraded'/);
    expect(PROD_ACCESS).not.toMatch(/IN \('premium', 'vip'\)/);
    expect(CHAT_ACCESS).toMatch(/v_membership_tier = 'upgraded'/);
  });
  it('activation reflects the package tier onto memberships', () => {
    expect(ACTIVATE).toMatch(/INSERT INTO public\.memberships/);
    expect(ACTIVATE).toMatch(/ON CONFLICT \(user_id\) DO UPDATE/);
  });
  it('create_membership cannot self-grant a paid tier', () => {
    expect(CREATE_MEMBERSHIP).toMatch(/v_tier <> 'basic'::membership_tier AND NOT public\.is_admin_or_staff/);
  });
});
