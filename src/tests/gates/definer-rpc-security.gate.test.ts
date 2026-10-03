/**
 * Definer-RPC-security gate — close access.mjs's migration blind spot
 *
 * access.mjs --static (CI governance-gate) lints aisha/db/sql/functions/*.sql for
 * the SEC_DEF_NO_AUTH class. Functions defined only in MIGRATIONS are invisible to
 * it. scripts/db/check-definer-rpc-security.mjs closes that blind spot by reading the
 * APPLIED catalog (in verify-cold-start-apply.sh step 5/5) for SECURITY DEFINER fns
 * exposed to PUBLIC/anon, no auth, not a (event-)trigger, and NOT in sql/functions/ —
 * failing on any not on the reviewed allowlist.
 *
 * This gate test is STATIC (same idiom as service-typecheck-baseline.gate): it does
 * NOT stand up Postgres (that is the cold-start gate's job). It guards the wiring +
 * the allowlist so neither can silently rot — e.g. someone drops the event_trigger
 * exclusion, or pads the allowlist to hide a real footgun.
 *
 * Found + fixed in the same change: a clean cold-start exposed the audience DEFINER
 * functions to PUBLIC/anon (the revoke lived only in live-ops, never a migration).
 * 20260531000000_audience_revoke_public_execute.sql captures that revoke; this gate
 * asserts the migration exists + is registered so it can never silently drop out.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const ALLOWLIST = resolve(ROOT, 'src/tests/gates/definer-rpc-security.allowlist.json');
const CHECK = resolve(ROOT, 'scripts/db/check-definer-rpc-security.mjs');
const COLD_START = resolve(ROOT, 'scripts/db/verify-cold-start-apply.sh');
const REVOKE_MIGRATION = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const REGISTRY = resolve(ROOT, 'aisha/db/migration-registry.json');
const DOC = resolve(ROOT, 'docs/security/DB_SECURITY_INVARIANTS.md');

interface Allowlist {
  _comment: string;
  allowlist: Array<{ name: string; reason: string }>;
}

describe('Definer-RPC-security gate', () => {
  test('allowlist exists and is well-formed', () => {
    expect(existsSync(ALLOWLIST), `Missing allowlist: ${ALLOWLIST}`).toBe(true);
    const a = JSON.parse(readFileSync(ALLOWLIST, 'utf-8')) as Allowlist;
    expect(typeof a._comment).toBe('string');
    expect(Array.isArray(a.allowlist)).toBe(true);
    for (const e of a.allowlist) {
      expect(typeof e.name, 'allowlist entry needs a name').toBe('string');
      expect(e.name.length).toBeGreaterThan(0);
      // Every entry must carry a human justification — no bare names. This is what
      // stops the allowlist from being a silent dumping ground for real footguns.
      expect(e.reason?.length ?? 0, `allowlist entry "${e.name}" needs a reason`).toBeGreaterThan(20);
    }
  });

  test('allowlist stays minimal (sanity cap — every entry is a vouched-safe exception)', () => {
    const a = JSON.parse(readFileSync(ALLOWLIST, 'utf-8')) as Allowlist;
    // The blind spot should trend to ZERO. If this list grows past a handful,
    // something is being waved through that should be fixed or moved to sql/functions/.
    expect(a.allowlist.length).toBeLessThan(15);
  });

  test('the check script holds the catalog query + SoT filter + allowlist + the FP fixes', () => {
    expect(existsSync(CHECK), `Missing checker: ${CHECK}`).toBe(true);
    const src = readFileSync(CHECK, 'utf-8');
    expect(src).toContain('prosecdef'); // SECURITY DEFINER, from the catalog (authoritative)
    expect(src).toContain('aisha/db/sql/functions'); // the SoT it filters against (access.mjs domain)
    expect(src).toContain('definer-rpc-security.allowlist.json');
    expect(src).toContain('--report');
    // event_trigger exclusion — the pgaudit_* false-positive fix
    expect(src).toContain('event_trigger');
    // auth-check pattern kept in sync with access.mjs
    expect(src).toContain('is_admin_or_staff');
  });

  test('cold-start gate step 5/5 runs the checker', () => {
    expect(existsSync(COLD_START)).toBe(true);
    const src = readFileSync(COLD_START, 'utf-8');
    expect(src).toContain('check-definer-rpc-security.mjs');
    expect(src).toContain('5/5  DB-security');
  });

  test('audience public-execute revoke is folded into the baseline SoT', () => {
    // The 20260531000000_audience_revoke_public_execute migration was absorbed
    // into the baseline (the chronological end-state of all migrations). Assert
    // its REVOKE…FROM PUBLIC effect persists in the canonical SoT so it can never
    // silently drop out — and that we are baseline-only (the registry lists 0
    // pending non-baseline migrations), which is now how durability is tracked.
    expect(existsSync(REVOKE_MIGRATION), 'baseline SoT missing').toBe(true);
    const sql = readFileSync(REVOKE_MIGRATION, 'utf-8');
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION/i);
    expect(sql).toContain('FROM PUBLIC');
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf-8')) as { migrations?: string[] };
    expect(registry.migrations ?? [], 'baseline-only: no pending non-baseline migrations').toEqual([]);
  });

  test('the security doc documents this gate + finding', () => {
    expect(existsSync(DOC)).toBe(true);
    const doc = readFileSync(DOC, 'utf-8');
    expect(doc).toContain('check-definer-rpc-security');
  });
});
