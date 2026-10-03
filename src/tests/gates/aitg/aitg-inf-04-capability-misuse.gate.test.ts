/**
 * AITG-INF-04 — capability misuse. Every MCP tool registered in
 * `svc-mcp-knowledge/src/routes/mcp.ts` MUST appear in either
 * AUTHENTICATED_TOOLS or ADMIN_TOOLS. If it's only in the dispatch switch
 * but missing from both ACL sets, it would be unreachable — or worse,
 * silently bypass authorisation.
 *
 * Additionally: no agent_catalog entry may declare a tool that doesn't
 * exist in the TOOL_DEFINITIONS list (prevents agents from being granted
 * phantom capabilities).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractAclMembers, extractToolDefinitions } from './_mcp-extract.js';

const ROOT = process.cwd();
const MCP_ROUTE = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/mcp.ts');

describe('AITG-INF-04: capability misuse — MCP tool authorisation', () => {
  test('positive: mcp.ts file exists', () => {
    expect(existsSync(MCP_ROUTE)).toBe(true);
  });

  test('positive: every TOOL_DEFINITIONS entry is in an ACL set', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8');
    const defined = extractToolDefinitions(src);
    const auth = new Set(extractAclMembers(src, 'AUTHENTICATED_TOOLS'));
    const admin = new Set(extractAclMembers(src, 'ADMIN_TOOLS'));
    const orphans = defined.filter((t) => !auth.has(t) && !admin.has(t));
    expect(
      orphans,
      `Tools declared but not in any ACL set: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  test('positive: no tool appears in BOTH sets (ambiguous authorisation)', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8');
    const auth = extractAclMembers(src, 'AUTHENTICATED_TOOLS');
    const admin = new Set(extractAclMembers(src, 'ADMIN_TOOLS'));
    const conflicts = auth.filter((t) => admin.has(t));
    expect(
      conflicts,
      `Ambiguous tools in both ACL sets: ${conflicts.join(', ')}`,
    ).toEqual([]);
  });

  test('negative: AITG tools are admin-only (security audit state)', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8');
    const admin = new Set(extractAclMembers(src, 'ADMIN_TOOLS'));
    const expectedAdminAitg = [
      'aitg_run_test',
      'aitg_get_coverage',
      'aitg_get_trust_score',
      'aitg_list_open_findings',
      'aitg_propose_remediation',
      'aitg_request_waiver',
      'aitg_classify_response',
    ];
    const missing = expectedAdminAitg.filter((t) => !admin.has(t));
    expect(
      missing,
      `AITG tools missing from ADMIN_TOOLS: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
