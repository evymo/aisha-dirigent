#!/usr/bin/env node
// =============================================================================
// tanstack-staletime.mjs — Phase 12 WP 2.5 staleTime audit
// =============================================================================
// TanStack Query defaults `staleTime: 0`, which re-fetches on every component
// mount. For static-ish data (workflow_statuses, agent_catalog, branding),
// that's a wasted Postgres RPC trip on every page navigation.
//
// This script scans every `src/hooks/*.ts` for `useQuery({...})` blocks and
// reports any that DON'T have an explicit `staleTime` option. The output is
// grouped by recommended category so the operator can apply defaults
// quickly:
//
//   Workflow lookup tables    -> staleTime: 5 * 60 * 1000   (5 min)
//   Agent catalog             -> staleTime: 10 * 60 * 1000  (10 min)
//   Story detail / kanban     -> staleTime: 30 * 1000       (30 sec)
//   useLiveTable subscribers  -> n/a (realtime invalidation handles freshness)
//
// SAFETY: Read-only fs scan. No shell out. JSON output via --json for CI.
//
// USAGE:
//   node scripts/audit/tanstack-staletime.mjs
//   node scripts/audit/tanstack-staletime.mjs --json
// =============================================================================
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const HOOKS_DIR = join(REPO_ROOT, 'src/hooks');
const JSON_OUT = process.argv.includes('--json');

// Hooks that do NOT need a staleTime check:
const ALLOWED = new Set([
  // useLiveTable handles freshness via realtime invalidation
  'useLiveTable.ts',
  // Mutations don't have staleTime
  'useMutation.ts',
]);

// Heuristic categories based on hook filename.
function categorize(filename) {
  const base = filename.replace(/\.tsx?$/, '');
  if (/(Live|Realtime|Stream|Watch)/.test(base)) {
    return { category: 'live', staleMs: 0, note: 'Realtime - useLiveTable should manage' };
  }
  if (/(WorkflowStatus|DeliveryStatus|Tier|Category|Status)/.test(base)) {
    return { category: 'lookup', staleMs: 5 * 60 * 1000, note: 'Workflow lookup - 5 min' };
  }
  if (/(AgentCatalog|AgentRegistry|Brand)/.test(base)) {
    return { category: 'catalog', staleMs: 10 * 60 * 1000, note: 'Agent catalog / branding - 10 min' };
  }
  if (/(Story|Kanban|Project|Partner)/.test(base)) {
    return { category: 'story', staleMs: 30 * 1000, note: 'Story-scoped - 30 sec' };
  }
  if (/(Admin|Metric|Stat|Health)/.test(base)) {
    return { category: 'admin', staleMs: 60 * 1000, note: 'Admin metrics - 60 sec' };
  }
  return { category: 'unknown', staleMs: 60 * 1000, note: 'Default 60 sec - review case-by-case' };
}

async function scanHook(file) {
  const content = await readFile(file, 'utf8');
  const findings = [];
  const calls = [];

  // Match useQuery generic + paren forms
  const re1 = /\buseQuery\s*</g;
  const re2 = /\buseQuery\s*\(\s*\{/g;
  let m;
  while ((m = re1.exec(content)) !== null) calls.push(m.index);
  while ((m = re2.exec(content)) !== null) calls.push(m.index);

  const lineOffsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineOffsets.push(i + 1);
  }
  const lineOf = (pos) => {
    let lo = 0, hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineOffsets[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const lines = content.split('\n');

  const seen = new Set();
  for (const idx of calls) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    // Walk forward to find matching closing brace of the options object
    const start = content.indexOf('{', idx);
    if (start === -1) continue;
    let depth = 1;
    let end = start + 1;
    while (end < content.length && depth > 0) {
      const c = content[end];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      end++;
    }
    const body = content.slice(start, end);
    if (!/\bstaleTime\s*:/.test(body)) {
      findings.push({
        file: relative(REPO_ROOT, file),
        line: lineOf(idx),
        snippet: lines[lineOf(idx) - 1].trim().slice(0, 100),
      });
    }
  }
  return findings;
}

async function main() {
  let entries;
  try {
    entries = await readdir(HOOKS_DIR);
  } catch {
    console.error(`[stale-time-audit:FATAL] Cannot read ${HOOKS_DIR}`);
    process.exit(1);
  }

  const allFindings = [];
  for (const f of entries) {
    if (!/\.tsx?$/.test(f)) continue;
    if (ALLOWED.has(f)) continue;
    const found = await scanHook(join(HOOKS_DIR, f));
    if (found.length > 0) {
      const cat = categorize(f);
      for (const finding of found) {
        allFindings.push({
          ...finding,
          category: cat.category,
          recommendedStaleMs: cat.staleMs,
          note: cat.note,
        });
      }
    }
  }

  const byCategory = new Map();
  for (const f of allFindings) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category).push(f);
  }

  if (JSON_OUT) {
    // Use stdout.write with callback to ensure the full payload drains
    // before process.exit(0). With console.log + sync exit, Node 20's
    // unflushed pipe buffer (~8KB) truncates the 40KB JSON output and
    // execFileSync parent gets partial data → JSON.parse fails. Gate
    // test wp-2-5-tanstack-staletime.gate.test.ts relies on this.
    const payload = JSON.stringify(
      { findings: allFindings, total: allFindings.length },
      null,
      2,
    );
    await new Promise((resolve) => process.stdout.write(payload + '\n', resolve));
  } else if (allFindings.length === 0) {
    console.log('OK: every useQuery has explicit staleTime');
  } else {
    console.log(`tanstack-staletime: ${allFindings.length} useQuery calls without staleTime`);
    console.log(`(across ${byCategory.size} categories)\n`);
    const order = ['live', 'lookup', 'catalog', 'admin', 'story', 'unknown'];
    for (const cat of order) {
      const items = byCategory.get(cat);
      if (!items || items.length === 0) continue;
      const note = items[0].note;
      const stale = items[0].recommendedStaleMs;
      console.log(`-- ${cat.toUpperCase()} (${items.length} hooks, recommended ${stale}ms - ${note}) --`);
      for (const i of items.slice(0, 10)) console.log(`  ${i.file}:${i.line}`);
      if (items.length > 10) console.log(`  ... and ${items.length - 10} more`);
      console.log('');
    }
    console.log('Recommended action: add `staleTime: <ms>` per category. See top of script for rationale.');
  }

  // Always exit 0 — this is a REPORT not a hard fail. Threshold-based gate
  // test enforces upper bound separately.
  process.exit(0);
}

main().catch((err) => {
  console.error('[stale-time-audit:FATAL]', err);
  process.exit(1);
});
