/**
 * sql-type-consistency gate test
 *
 * Cross-references RETURNS TABLE column types in SQL functions against
 * actual table/view column definitions. Ensures:
 *   1. No type mismatches (e.g., integer vs bigint, text vs text[])
 *   2. No references to missing materialized views
 *
 * Uses scripts/db/func-manager/lib/type-checker.mjs
 * Runs via vitest.gates.config.ts (node env, 2 min timeout).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';

interface TypeIssue {
  severity: string;
  rule: string;
  func: string;
  file: string;
  message: string;
  details: Record<string, string>;
}

interface SchemaRegistry {
  tables: Map<string, Map<string, string>>;
  knownRelations: Set<string>;
}

let buildSchemaRegistry: (rootDir: string) => SchemaRegistry;
let checkAllFunctions: (
  rootDir: string,
  registry?: SchemaRegistry,
) => TypeIssue[];

const ROOT = path.resolve(__dirname, '../../..');

beforeAll(async () => {
  const typeChecker = await import(
    path.join(ROOT, 'scripts/db/func-manager/lib/type-checker.mjs')
  );
  buildSchemaRegistry = typeChecker.buildSchemaRegistry;
  checkAllFunctions = typeChecker.checkAllFunctions;
});

describe('SQL Type Consistency', () => {
  let issues: TypeIssue[];

  beforeAll(() => {
    const registry = buildSchemaRegistry(ROOT);
    issues = checkAllFunctions(ROOT, registry);
  });

  it('should have no RETURNS TABLE type mismatches', () => {
    const mismatches = issues.filter((i) => i.rule === 'TYPE_MISMATCH');
    if (mismatches.length > 0) {
      const summary = mismatches
        .map(
          (i) =>
            `  ${i.func}: ${i.details.column} ${i.details.returnType} vs ${i.details.table}.${i.details.tableType}`,
        )
        .join('\n');
      expect.fail(
        `${mismatches.length} TYPE_MISMATCH issue(s):\n${summary}`,
      );
    }
  });

  it('should have no references to missing materialized views', () => {
    const missing = issues.filter((i) => i.rule === 'MISSING_MATVIEW');
    if (missing.length > 0) {
      const summary = missing
        .map((i) => `  ${i.func}: ${i.details.matview}`)
        .join('\n');
      expect.fail(
        `${missing.length} MISSING_MATVIEW issue(s):\n${summary}`,
      );
    }
  });

  it('should have no SETOF references to missing tables', () => {
    const missing = issues.filter((i) => i.rule === 'MISSING_SETOF_TARGET');
    if (missing.length > 0) {
      const summary = missing
        .map((i) => `  ${i.func}: ${i.details.target}`)
        .join('\n');
      expect.fail(
        `${missing.length} MISSING_SETOF_TARGET issue(s):\n${summary}`,
      );
    }
  });
});
