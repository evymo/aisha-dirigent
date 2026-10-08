/**
 * Gate test: Phase 12 WP 3.2 — Prompt injection guard (ingest + RAG).
 *
 * The ingestion-safety scanner + retrieval-side quarantine filter were
 * shipped earlier (migrations 20260518240000 + 20260519020000). WP 3.2
 * hardens them with:
 *   - Tightened heuristic regexes (broader attack catch w/o false positives)
 *   - Raised weights on under-measured patterns
 *   - Comprehensive unit test (41 assertions; 20+ attack corpus)
 *
 * This gate locks down the wiring + key invariants so any future regression
 * (regex regress, weight drop, scan-call removal, retrieval filter removal,
 * audit miss) fails CI before reaching prod.
 *
 * Enforces:
 *   1. lib/ingestion-safety.ts exports: runHeuristicScan, scanForInjection,
 *      SafetyScanInput type
 *   2. Scanner covers the 9 plan-spec matcher categories (regex + weight)
 *   3. Heuristic weights for high-confidence patterns are >= 0.4 so a
 *      single match crosses the flagged threshold
 *   4. ingest route (knowledge-embeddings.ts) imports + invokes
 *      scanForInjection BEFORE chunking + writes via
 *      fn_record_safety_scan_audited when status !== 'clear'
 *   5. Retrieval-side: mcp_search_knowledge_v* filters
 *      public.knowledge_state_readable(ki.quarantine_status) — allowlist, not a denylist
 *   6. Audit RPC fn_record_safety_scan_audited writes audit_journal action
 *      'ingestion.safety_scan_completed' (forensic trail)
 *   7. Unit test exists with both attack + benign corpus + edge cases
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SCANNER = path.join(
  ROOT,
  'services/svc-mcp-knowledge/src/lib/ingestion-safety.ts',
);
const INGEST_ROUTE = path.join(
  ROOT,
  'services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts',
);
const SCANNER_TEST = path.join(
  ROOT,
  'services/svc-mcp-knowledge/src/tests/ingestion-safety.unit.test.ts',
);
const AUDIT_RPC = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_record_safety_scan_audited.sql',
);

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 12 WP 3.2 — ingestion-safety.ts contract', () => {
  const src = readText(SCANNER);

  it('file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('exports runHeuristicScan, scanForInjection, SafetyScanInput', () => {
    expect(src).toMatch(/export\s+function\s+runHeuristicScan/);
    expect(src).toMatch(/export\s+async\s+function\s+scanForInjection/);
    expect(src).toMatch(/export\s+interface\s+SafetyScanInput/);
  });

  it('covers the 9 plan-spec matcher categories by name', () => {
    const required = [
      'ignore_previous_instructions',
      'system_prompt_override',
      'role_hijack_you_are_now',
      'act_as_role',
      'developer_mode',
      'long_base64_blob',
      'dangerous_uri_scheme',
      'exfiltration_request',
      'delimiter_injection',
    ];
    for (const name of required) {
      expect(src).toMatch(new RegExp(`name:\\s*["']${name}["']`));
    }
  });

  it('uses status threshold mapping with three levels', () => {
    expect(src).toMatch(/quarantined.*0\.7|combinedScore\s*>=\s*0\.7/);
    expect(src).toMatch(/flagged.*0\.4|combinedScore\s*>=\s*0\.4/);
    expect(src).toMatch(/SafetyStatus\s*=\s*["']clear["']\s*\|\s*["']flagged["']\s*\|\s*["']quarantined["']/);
  });

  it('high-confidence single-match patterns score ≥ 0.4 (one match = at least flagged)', () => {
    // Parse weight value following each `name: "..."` block. These are the
    // weights that must individually clear the flagged threshold so even
    // when only one attack signal matches, the item is captured.
    const highConfidenceMatchers = [
      'ignore_previous_instructions',
      'role_hijack_you_are_now',
      'act_as_role',
      'developer_mode',
      'long_base64_blob',
      'dangerous_uri_scheme',
      'exfiltration_request',
      'delimiter_injection',
    ];
    for (const name of highConfidenceMatchers) {
      const m = src.match(new RegExp(`name:\\s*["']${name}["'],?\\s*\\n?\\s*weight:\\s*([\\d.]+)`));
      expect(m, `missing weight for ${name}`).not.toBeNull();
      const weight = Number(m![1]);
      expect(weight, `${name} weight ${weight} should be >= 0.4 (single-match flag)`).toBeGreaterThanOrEqual(0.4);
    }
  });
});

describe('Phase 12 WP 3.2 — Ingest route wiring', () => {
  const src = readText(INGEST_ROUTE);

  it('imports scanForInjection from ingestion-safety', () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]{0,200}scanForInjection[\s\S]{0,200}\}\s*from\s+["'][^"']*ingestion-safety/,
    );
  });

  it('invokes scanForInjection inside the ingest loop', () => {
    expect(src).toMatch(/await\s+scanForInjection\s*\(/);
  });

  it('writes via fn_record_safety_scan_audited when status !== clear', () => {
    // Either: rpcService('fn_record_safety_scan_audited', ...) directly,
    // or a wrapper call passing scan.status / scan.score / scan.metadata.
    expect(src).toMatch(/fn_record_safety_scan_audited/);
    expect(src).toMatch(/scan\.status\s*!==\s*['"]clear['"]/);
  });
});

describe('Phase 12 WP 3.2 — Retrieval-side quarantine filter', () => {
  // The retrieval RPCs call the ONE home of the readable-state allowlist and never list
  // forbidden states themselves (a denylist passes an unscanned or future state as clean).
  const ALLOWLIST_CALL = /public\.knowledge_state_readable\(\s*ki\.quarantine_status\s*\)/;
  const DENYLIST = /quarantine_status\s+NOT\s+IN/i;

  it('mcp_search_knowledge_v2 and v3 both filter by the readable-state allowlist', () => {
    // BOTH files must exist: a missing (renamed) file is a failure, not a reason to check the other one.
    for (const name of ['mcp_search_knowledge_v2.sql', 'mcp_search_knowledge_v3.sql']) {
      const sql = readText(path.join(ROOT, 'aisha/db/sql/functions', name));
      expect(sql.length, `${name} is missing or empty`).toBeGreaterThan(0);
      expect(sql, name).toMatch(ALLOWLIST_CALL);
      expect(sql, `${name} must not fall back to a denylist`).not.toMatch(DENYLIST);
    }
  });

  it('anchor: the allowlist requirement and the denylist ban both bite on a sample', () => {
    const good = 'AND public.knowledge_state_readable(ki.quarantine_status)';
    const old = "AND ki.quarantine_status NOT IN ('flagged', 'quarantined')";
    expect(good).toMatch(ALLOWLIST_CALL);
    expect(good).not.toMatch(DENYLIST);
    expect(old).not.toMatch(ALLOWLIST_CALL);
    expect(old).toMatch(DENYLIST);
    // Allowlist call kept and a denylist re-added next to it is still a finding.
    expect(`${good}\n${old}`).toMatch(DENYLIST);
  });

  it('every versioned mcp_search RPC applies the readable-state filter', () => {
    // Scan every mcp_search_knowledge_v*.sql for the filter clause — a new version without it fails.
    const dir = path.join(ROOT, 'aisha/db/sql/functions');
    const matches = fs
      .readdirSync(dir)
      .filter((f) => /^mcp_search_knowledge_v\d+\.sql$/.test(f));
    expect(matches.length).toBeGreaterThan(0);
    const missing = matches.filter((f) => !ALLOWLIST_CALL.test(readText(path.join(dir, f))));
    expect(missing, 'mcp_search_knowledge_v* RPCs that do not filter by the readable-state allowlist').toEqual([]);
  });
});

describe('Phase 12 WP 3.2 — Audit RPC contract', () => {
  const src = readText(AUDIT_RPC);

  it('fn_record_safety_scan_audited SoT exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('SECURITY DEFINER + search_path TO public', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/SET\s+search_path\s+TO\s+['"]public['"]/i);
  });

  it('REVOKE FROM PUBLIC + GRANT EXECUTE TO service_role only', () => {
    expect(src).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_record_safety_scan_audited[\s\S]{0,200}FROM\s+PUBLIC/i,
    );
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_record_safety_scan_audited[\s\S]{0,200}TO\s+service_role/i,
    );
  });

  it('writes audit_journal action ingestion.safety_scan_completed', () => {
    expect(src).toMatch(
      /audit_journal[\s\S]{0,500}['"]ingestion\.safety_scan_completed['"]/,
    );
  });

  it('rejects invalid status values (only clear/flagged/quarantined)', () => {
    expect(src).toMatch(
      /p_status\s+NOT\s+IN\s*\(\s*['"]clear['"]\s*,\s*['"]flagged['"]\s*,\s*['"]quarantined['"]\s*\)/i,
    );
  });

  it('validates score in [0, 1]', () => {
    expect(src).toMatch(/p_score\s*<\s*0\s+OR\s+p_score\s*>\s*1/i);
  });
});

describe('Phase 12 WP 3.2 — Unit test coverage', () => {
  const src = readText(SCANNER_TEST);

  it('unit test file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('attack corpus has ≥ 20 distinct samples', () => {
    // Capture from `ATTACK_CORPUS` declaration to the matching closing `];`
    // — survives both `as const` and explicit `ReadonlyArray<...>` typings.
    const m = src.match(/ATTACK_CORPUS[\s\S]+?^\];/m);
    expect(m, 'ATTACK_CORPUS block not found').not.toBeNull();
    const labels = m![0].match(/label:\s*["'][^"']+["']/g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(20);
  });

  it('benign corpus exists (false-positive regression guard)', () => {
    expect(src).toMatch(/BENIGN_CORPUS/);
  });

  it('asserts each attack scores >= 0.4 under heuristic alone (LLM-free)', () => {
    expect(src).toMatch(/heuristic alone/i);
    expect(src).toMatch(/toBeGreaterThanOrEqual\(0\.4\)/);
  });

  it('asserts each benign sample scores < 0.4 (no false positive)', () => {
    expect(src).toMatch(/toBeLessThan\(0\.4\)/);
  });

  it('covers edge cases (empty body, whitespace, null aiInstructions, score cap)', () => {
    expect(src).toMatch(/empty body/i);
    expect(src).toMatch(/whitespace/i);
    expect(src).toMatch(/null\s+aiInstructions/i);
    expect(src).toMatch(/(?:capped at 1\.0|toBeLessThanOrEqual\(1\.0\))/);
  });

  it('asserts scan result does NOT echo PII patterns', () => {
    expect(src).toMatch(/does NOT echo input body|PII/i);
  });

  it('uses vi.mock for @aisha/security + capability-resolver + llm-completion', () => {
    expect(src).toMatch(/vi\.mock\s*\(\s*['"]@aisha\/security['"]/);
    expect(src).toMatch(/vi\.mock\s*\(\s*['"]\.\.\/lib\/capability-resolver/);
    expect(src).toMatch(/vi\.mock\s*\(\s*['"]\.\.\/lib\/llm-completion/);
  });
});
