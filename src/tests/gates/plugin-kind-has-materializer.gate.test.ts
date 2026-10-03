/**
 * Gate: every declared plugin kind has a materializer — and the whole chain
 * agrees on what the kinds ARE.
 *
 * WHY (measured 2026-07-26): schemas/plugin-manifest.schema.json declared 6
 * kinds while aisha/db/sql/functions/ contained exactly ONE materializer
 * (agents). A manifest of any other kind validated, submitted, produced a
 * plugin_catalog row — and its declared capability never reached a runtime
 * registry, so the resolver could never route to it. Nothing errored; the
 * artifact was green and wired to nothing. This gate makes that state
 * unrepresentable: a kind added to the JSON schema or the DB enum without a
 * dispatch branch + materialize_* function fails HERE, and (belt+braces) the
 * dispatcher's ELSE RAISE fails at first live approval.
 *
 * Enforces expert_rule 'declared-extension-must-reach-the-resolver'
 * (aisha/db/seed/core/40_extension_spine_doctrine.sql).
 *
 * Checks:
 *  1. JSON-schema kind enum ≡ DB enum plugin_kind (same set).
 *  2. Every kind has a dispatch branch in materialize_plugin.sql
 *     (WHEN '<kind>' THEN), except the dispatcher must also keep its ELSE RAISE.
 *  3. Every non-composite kind has a materialize_<kind-ish> SoT file, and every
 *     spec-carrying kind has its spec column in plugin_catalog.sql + a spec
 *     block in the JSON schema.
 *  4. The approval/lifecycle call sites go through the dispatcher, not the
 *     agent-only materializer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

// kind → { fn: materializer SoT file, spec: spec column/block } (full_stack is
// composite: dispatch-only, no own registry/spec).
const KIND_CONTRACT: Record<string, { fn: string | null; spec: string | null }> = {
  agent:            { fn: 'materialize_agent_runtime',    spec: 'agent_spec' },
  backend_provider: { fn: 'materialize_backend_provider', spec: 'provider_spec' },
  automation_node:  { fn: 'materialize_automation_node',  spec: 'node_spec' },
  auth_provider:    { fn: 'materialize_auth_provider',    spec: 'auth_spec' },
  web_tracking:     { fn: 'materialize_web_tracking',     spec: 'tracking_spec' },
  data_source:      { fn: 'materialize_data_source',      spec: 'source_spec' },
  full_stack:       { fn: null,                           spec: null },
};

function schemaKinds(): string[] {
  const schema = JSON.parse(read('schemas/plugin-manifest.schema.json'));
  return schema.properties.kind.enum as string[];
}

function dbEnumKinds(): string[] {
  const sql = read('aisha/db/sql/enums/plugin_kind.sql');
  const m = sql.match(/CREATE TYPE public\.plugin_kind AS ENUM \(([^)]*)\)/);
  if (!m) throw new Error('plugin_kind CREATE TYPE not found');
  const listed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  // Values added post-release arrive via idempotent ALTERs — same file, both
  // paths must agree with the JSON schema, so collect them too.
  const altered = [...sql.matchAll(/ADD VALUE IF NOT EXISTS '([a-z_]+)'/g)].map((x) => x[1]);
  return [...new Set([...listed, ...altered])];
}

describe('gate: plugin-kind-has-materializer', () => {
  const kinds = schemaKinds();

  it('JSON schema and DB enum declare the same kind set', () => {
    expect([...kinds].sort()).toEqual([...dbEnumKinds()].sort());
  });

  it('the contract table above covers exactly the declared kinds (adding a kind forces a decision here)', () => {
    expect(Object.keys(KIND_CONTRACT).sort()).toEqual([...kinds].sort());
  });

  const dispatcher = read('aisha/db/sql/functions/materialize_plugin.sql');

  it.each(kinds)('kind %s has a dispatch branch in materialize_plugin', (kind) => {
    expect(dispatcher).toMatch(new RegExp(`WHEN '${kind}' THEN`));
  });

  it('the dispatcher keeps its ELSE RAISE (unknown kind fails loud, never silently)', () => {
    expect(dispatcher).toMatch(/ELSE\s+RAISE EXCEPTION 'No materializer for plugin kind/);
  });

  const catalogSql = read('aisha/db/sql/tables/plugin_catalog.sql');
  const manifestSchema = JSON.parse(read('schemas/plugin-manifest.schema.json'));

  for (const [kind, contract] of Object.entries(KIND_CONTRACT)) {
    if (!contract.fn) continue;
    it(`kind ${kind}: materializer SoT file exists and is service_role-only`, () => {
      const fn = read(`aisha/db/sql/functions/${contract.fn}.sql`);
      expect(fn).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${contract.fn}\\(`));
      expect(fn).toMatch(/SECURITY DEFINER/);
      expect(fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${contract.fn}\\(uuid\\) FROM PUBLIC`));
      expect(fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${contract.fn}\\(uuid\\) TO service_role`));
    });
    it(`kind ${kind}: spec column ${contract.spec} exists in plugin_catalog + JSON schema`, () => {
      expect(catalogSql).toMatch(new RegExp(`^\\s*${contract.spec} jsonb`, 'm'));
      expect(manifestSchema.properties[contract.spec as string]).toBeDefined();
    });
  }

  it('approval/lifecycle call sites dispatch by kind (not agent-only)', () => {
    for (const f of ['transition_plugin_status', 'fn_aisha_kb_decision', 'review_moderation_item']) {
      const sql = read(`aisha/db/sql/functions/${f}.sql`);
      expect(sql, `${f} must call the dispatcher`).toMatch(/materialize_plugin\(/);
      expect(sql, `${f} must not bypass to the agent-only materializer`).not.toMatch(
        /PERFORM public\.materialize_agent_runtime\(/
      );
    }
  });

  it('deactivation goes through the kill-switch dispatcher in transition_plugin_status', () => {
    const sql = read('aisha/db/sql/functions/transition_plugin_status.sql');
    expect(sql).toMatch(/deactivate_plugin_runtime\(/);
  });
});
