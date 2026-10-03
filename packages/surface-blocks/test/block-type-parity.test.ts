import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { blockSchema, layoutSchema } from '../src/schemas.js';

/**
 * The block-type vocabulary is a TRIPLE that must move in lockstep:
 *   1) the Ajv anyOf branches in schemas.ts (blockSchema)
 *   2) the layout enum in schemas.ts (layoutSchema)
 *   3) the Postgres CHECK on surface_blocks.block_type (aisha/db/sql/tables/surface_blocks.sql)
 * This test fails loudly if any one drifts (adding a block type in only two of the three).
 *
 * Deliberately ONLY block_type: that is the CLOSED side of the contract (a
 * renderer the client must ship). The `surface` column is the OPEN side —
 * sections are backend data, so there is no enum to keep in lockstep.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
// Path pinned to THIS repo's SoT. The test arrived from the aisha-multi-surface
// staging repo with its `db/tables/` layout and nothing in CI executed it, so
// the ENOENT stayed invisible until the suite was wired into the pipeline.
const sqlPath = path.resolve(here, '../../../aisha/db/sql/tables/surface_blocks.sql');

function sortedUnique(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

describe('block_type vocabulary parity (types/schema/SQL lockstep)', () => {
  const fromAnyOf = sortedUnique(
    (blockSchema.anyOf as Array<{ properties?: { block_type?: { const?: string } } }>)
      .map((b) => b.properties?.block_type?.const)
      .filter((x): x is string => typeof x === 'string')
  );
  const fromLayoutEnum = sortedUnique(layoutSchema.properties.blocks.items.properties.block_type.enum as string[]);

  const sql = readFileSync(sqlPath, 'utf8');
  // Grab the block_type CHECK ( ... IN ('a','b',...) ) list.
  const checkMatch = sql.match(/block_type[\s\S]*?in\s*\(([^)]*)\)/i);
  const fromSql = sortedUnique(
    [...(checkMatch?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  );

  it('anyOf branches match the layout enum', () => {
    expect(fromAnyOf).toEqual(fromLayoutEnum);
  });

  it('the SQL CHECK matches the schema vocabulary', () => {
    expect(fromSql.length).toBeGreaterThan(0);
    expect(fromSql).toEqual(fromAnyOf);
  });

  it('includes the document-management additions', () => {
    expect(fromAnyOf).toContain('record_detail');
    expect(fromAnyOf).toContain('review_queue');
  });
});
