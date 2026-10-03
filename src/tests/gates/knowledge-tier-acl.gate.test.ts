/**
 * Gate: Brick6 tier-ACL (#27).
 *
 * Locks the SoT for tier-gated retrieval:
 *   - knowledge_items.minimum_tier column;
 *   - audience_compute_actor_tier (the UNGUARDED tier source of truth — a boolean gate exposes
 *     no stats) + a fail-closed 2-arg audience_user_meets_tier_requirement(text, uuid) with an
 *     admin special-case;
 *   - v3 + v2 apply it as a HARD WHERE filter (under-tier never retrieves a gated row — unlike
 *     locale, which is a soft boost);
 *   - the audience user is service-overridable but spoof-safe (authenticated callers pinned to
 *     auth.uid()); the live callers (route, compose_context) pass the end-user id.
 * Runtime deny/allow proof lives in aisha/db/tests/schema/11_knowledge_tier_acl.sql.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const TABLE = read('aisha/db/sql/tables/knowledge_items.sql');
const MEETS = read('aisha/db/sql/functions/audience_user_meets_tier_requirement.sql');
const COMPUTE = read('aisha/db/sql/functions/audience_compute_actor_tier.sql');
const V3 = read('aisha/db/sql/functions/mcp_search_knowledge_v3.sql');
const V2 = read('aisha/db/sql/functions/mcp_search_knowledge_v2.sql');
const GETITEM = read('aisha/db/sql/functions/mcp_get_knowledge_item.sql');
const ROUTE = read('services/svc-mcp-knowledge/src/routes/mcp.ts');
const COMPOSE = read('aisha/db/sql/functions/compose_context.sql');
const PGTAP = read('aisha/db/tests/schema/11_knowledge_tier_acl.sql');

describe('#27 Brick6 — tier-ACL', () => {
  it('minimum_tier column + unguarded compute + fail-closed 2-arg meets_tier', () => {
    expect(TABLE).toMatch(/ADD COLUMN IF NOT EXISTS minimum_tier text/);
    expect(COMPUTE).toMatch(/CREATE OR REPLACE FUNCTION public\.audience_compute_actor_tier/);
    // the 2-arg overload exists, derives via the unguarded compute, and admin/staff meet every tier.
    expect(MEETS).toMatch(/audience_user_meets_tier_requirement\(p_required_tier text, p_user_id uuid\)/);
    expect(MEETS).toMatch(/audience_compute_actor_tier\(p_user_id\)/);
    expect(MEETS).toMatch(/is_admin_or_staff\(p_user_id\)/);
  });

  it('v3 + v2 apply the tier-ACL as a HARD WHERE filter (not a score term)', () => {
    for (const [name, src] of [['v3', V3], ['v2', V2]] as const) {
      expect(src, `${name} must hard-filter by minimum_tier`).toMatch(
        /AND \(ki\.minimum_tier IS NULL OR public\.audience_user_meets_tier_requirement\(ki\.minimum_tier,/,
      );
    }
  });

  it('single-item retrieval (mcp_get_knowledge_item) hard-filters by minimum_tier too', () => {
    // The by-id/slug accessor must not be a tier bypass around the search filter.
    expect(GETITEM, 'mcp_get_knowledge_item must hard-filter by minimum_tier').toMatch(
      /ki\.minimum_tier IS NULL\s+OR public\.audience_user_meets_tier_requirement\(ki\.minimum_tier, auth\.uid\(\)\)/,
    );
  });

  it('the audience user is service-overridable but spoof-safe (authenticated pinned to self)', () => {
    expect(V3).toMatch(/WHEN v_caller_role = 'service_role' THEN COALESCE\(p_audience_user_id, auth\.uid\(\)\)/);
    expect(V3).toMatch(/ELSE auth\.uid\(\)/);
    // the v2 GLOBAL overload pins to auth.uid() (no arg → no collision with the story signature).
    expect(V2).toMatch(/GLOBAL overload pins the audience user to auth\.uid\(\)/);
  });

  it('the live callers pass the end-user id', () => {
    expect(ROUTE).toMatch(/p_audience_user_id: audienceUserId/);
    expect(COMPOSE).toMatch(/p_audience_user_id := v_requester/);
  });

  it('pgTAP proves deny + allow + fail-closed', () => {
    expect(PGTAP).toMatch(/SELECT plan\(7\)/);
    expect(PGTAP).toMatch(/EXCLUDES a partner-gated item from a registered user/);
    expect(PGTAP).toMatch(/RETURNS the partner-gated item to a partner-tier user/);
  });
});
