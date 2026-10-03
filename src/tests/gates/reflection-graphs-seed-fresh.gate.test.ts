/**
 * Gate — the reflection-graph seed is GENERATED from the .json SoT and FRESH.
 *
 * The reflection orchestrator loads its graph from ai_workflow_definitions by
 * name; the rows are generated from services/svc-ai-chat/src/reflection/graphs/
 * *.json into aisha/db/seed/core/33_reflection_graphs.sql. This gate locks the
 * two in lockstep — a graph edited without regenerating the seed (or vice versa)
 * reds offline — so the "authored .json but no DB row" gap cannot reopen.
 *
 * Regenerate: npm run db:seed:reflection-graphs
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSeedSql, OUTPUT_FILE } from '../../../scripts/db/gen-reflection-graph-seed.mjs';

describe('reflection-graphs seed — generated + fresh', () => {
  it('committed seed byte-matches the generator output (else: npm run db:seed:reflection-graphs)', () => {
    const committed = readFileSync(OUTPUT_FILE, 'utf8');
    expect(committed).toBe(buildSeedSql());
  });

  it('registers the reasoning-tree (E1) graph so the orchestrator can load it', () => {
    const sql = readFileSync(OUTPUT_FILE, 'utf8');
    expect(sql).toMatch(/'reasoning-tree-reflect'/);
    expect(sql).toMatch(/INSERT INTO public\.ai_workflow_definitions/);
    expect(sql).toMatch(/ON CONFLICT \(name\) DO UPDATE/);
  });

  it('every reflection graph .json is represented as a seeded row', () => {
    const sql = readFileSync(OUTPUT_FILE, 'utf8');
    for (const name of ['deploy-reflect', 'story-plan-reflect', 'reasoning-tree-reflect']) {
      expect(sql, `missing seed row for ${name}`).toContain(`'${name}'`);
    }
  });
});
