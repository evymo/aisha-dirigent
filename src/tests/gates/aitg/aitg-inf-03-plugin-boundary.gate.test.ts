/**
 * AITG-INF-03 — Plugin Boundary Violations.
 *
 * The MCP plugin manifest (TOOL_DEFINITIONS + AUTHENTICATED_TOOLS +
 * ADMIN_TOOLS sets in svc-mcp-knowledge/src/routes/mcp.ts) declares the
 * complete set of plugin tools. The actual `callTool()` dispatch switch
 * MUST exactly match: no tool can be invocable without being declared,
 * no declared tool can be unreachable.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractAclMembers,
  extractDispatchedTools,
  extractToolDefinitions,
} from './_mcp-extract.js';

const ROOT = process.cwd();
const MCP_ROUTE = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/mcp.ts');

describe('AITG-INF-03: plugin boundary — TOOL_DEFINITIONS ≡ dispatch ≡ ACL', () => {
  test('positive: mcp.ts exists', () => {
    expect(existsSync(MCP_ROUTE)).toBe(true);
  });

  test('positive: every TOOL_DEFINITIONS entry has a dispatch case', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8');
    const defined = new Set(extractToolDefinitions(src));
    const dispatched = new Set(extractDispatchedTools(src));
    const unreachable = [...defined].filter((t) => !dispatched.has(t));
    expect(
      unreachable,
      `Declared tools without dispatch case (unreachable): ${unreachable.join(', ')}`,
    ).toEqual([]);
  });

  test('negative: no dispatch case for a tool that is not declared', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8');
    const defined = new Set(extractToolDefinitions(src));
    const dispatched = extractDispatchedTools(src);
    const ghost = dispatched.filter((t) => !defined.has(t));
    expect(
      ghost,
      `Dispatch cases without TOOL_DEFINITIONS entry (ghost tools): ${ghost.join(', ')}`,
    ).toEqual([]);
  });

  test('positive: every tool sits in exactly one ACL set (authenticated OR admin)', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8');
    const defined = extractToolDefinitions(src);
    const auth = new Set(extractAclMembers(src, 'AUTHENTICATED_TOOLS'));
    const admin = new Set(extractAclMembers(src, 'ADMIN_TOOLS'));
    const issues: string[] = [];
    for (const t of defined) {
      const a = auth.has(t);
      const d = admin.has(t);
      if (!a && !d) issues.push(`${t}: no ACL`);
      if (a && d) issues.push(`${t}: in both ACLs (ambiguous)`);
    }
    expect(issues).toEqual([]);
  });
});
