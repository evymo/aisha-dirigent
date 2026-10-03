#!/usr/bin/env node
// =============================================================================
// bundle-budget.mjs — Phase 12 WP 4.6 bundle size audit
// =============================================================================
// Walks dist/assets/ (or custom path) and reports per-file gzip size + raw
// size. Categorizes by Vite chunking pattern:
//
//   index-<hash>.js              -> root bundle (initial download)
//   <chunk-name>-<hash>.js       -> code-split lazy chunk
//   vendor-<x>-<hash>.js         -> vendor chunks (React, recharts, etc.)
//
// Per Phase 12 WP 4.6 spec:
//   - Initial bundle (root + router shell) < 150 kB gz
//   - Each lazy chunk < 250 kB gz
//   - Vendor chunks tolerated up to 500 kB gz (React+ecosystem)
//
// The audit is RATCHET-baseline (same pattern as WP 2.5 staleTime): locks
// current state, fails if any individual chunk regresses by >5 % vs baseline.
//
// SAFETY: pure fs scan + node:zlib. No shell-out. JSON output via --json.
//
// USAGE
//   node scripts/audit/bundle-budget.mjs            # human report
//   node scripts/audit/bundle-budget.mjs --json     # machine output
//   node scripts/audit/bundle-budget.mjs --update-baseline
// =============================================================================
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DIST_DIR = process.env.AISHA_BUNDLE_DIR ?? join(REPO_ROOT, 'dist');
const BASELINE_PATH = join(
  REPO_ROOT,
  'src/tests/gates/wp-4-6-bundle-budget.baseline.json',
);
const JSON_OUT = process.argv.includes('--json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

// Hard budgets in BYTES (gzipped). Per Phase 12 WP 4.6 spec.
const BUDGET = {
  initial: 150 * 1024, // 150 kB gz — index-*.js
  lazy: 250 * 1024, // 250 kB gz — per route chunk
  vendor: 500 * 1024, // 500 kB gz — React + ecosystem
};

const log = (...a) => console.log('[bundle]', ...a);

function categorize(filename) {
  if (filename.startsWith('index-') || filename === 'index.js') return 'initial';
  if (filename.startsWith('vendor')) return 'vendor';
  return 'lazy';
}

async function walkJsFiles(dir) {
  const out = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await walkJsFiles(full)));
      } else if (e.isFile() && /\.js$/.test(e.name)) {
        out.push(full);
      }
    }
  } catch (err) {
    // Walk failures are expected (transient FS races, ENOENT on async
    // directory removal); log so the audit run is debuggable but don't
    // crash — we'd rather report a partial bundle than no report.
    console.warn(`[bundle:WARN] readdir failed for ${dir}: ${err.message}`);
  }
  return out;
}

async function measure(file) {
  const buf = await readFile(file);
  const gz = gzipSync(buf, { level: 9 });
  return {
    file: file.replace(REPO_ROOT + '/', ''),
    name: basename(file),
    rawBytes: buf.length,
    gzipBytes: gz.length,
    category: categorize(basename(file).replace(/-[a-zA-Z0-9_-]+\.js$/, '-X.js')),
  };
}

async function loadBaseline() {
  try {
    const txt = await readFile(BASELINE_PATH, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function main() {
  // ENOENT is the expected "no dist yet" path → handled below with explicit
  // FATAL log; any other error (perm, EIO) still flows to null and surfaces
  // the same way after a console.warn for debuggability.
  const distStat = await stat(DIST_DIR).catch((err) => {
    if (err.code !== 'ENOENT') console.warn(`[bundle:WARN] stat ${DIST_DIR}: ${err.message}`);
    return null;
  });
  if (!distStat) {
    console.error(`[bundle:FATAL] dist/ not found at ${DIST_DIR}`);
    console.error('Run `npm run build` first to populate dist/.');
    process.exit(JSON_OUT ? 0 : 1);
  }

  const files = await walkJsFiles(join(DIST_DIR, 'assets'));
  if (files.length === 0) {
    console.error(
      `[bundle:FATAL] no .js files in ${DIST_DIR}/assets — was the build successful?`,
    );
    process.exit(JSON_OUT ? 0 : 1);
  }

  const measured = await Promise.all(files.map(measure));
  measured.sort((a, b) => b.gzipBytes - a.gzipBytes);

  // Group by chunk template name (strip hash suffix)
  const byTemplate = new Map();
  for (const m of measured) {
    const tpl = m.name.replace(/-[a-zA-Z0-9_-]+\.js$/, '');
    const prev = byTemplate.get(tpl);
    if (!prev || prev.gzipBytes < m.gzipBytes) byTemplate.set(tpl, m);
  }

  const violations = [];
  for (const m of byTemplate.values()) {
    const limit = BUDGET[m.category] ?? BUDGET.lazy;
    if (m.gzipBytes > limit) {
      violations.push({
        ...m,
        budgetBytes: limit,
        overBytes: m.gzipBytes - limit,
      });
    }
  }

  // Baseline ratchet — any single chunk over 5 % of its baseline = regression
  const baseline = await loadBaseline();
  const regressions = [];
  if (baseline?.chunks) {
    for (const [tpl, m] of byTemplate) {
      const base = baseline.chunks[tpl];
      if (!base) continue; // new chunk — flagged by budget violation if too big
      const tolerance = base.gzipBytes * 1.05;
      if (m.gzipBytes > tolerance) {
        regressions.push({
          template: tpl,
          baselineBytes: base.gzipBytes,
          currentBytes: m.gzipBytes,
          growthPct: ((m.gzipBytes - base.gzipBytes) / base.gzipBytes) * 100,
        });
      }
    }
  }

  const report = {
    summary: {
      generated_at: new Date().toISOString(),
      total_chunks: byTemplate.size,
      total_gzip_bytes: measured.reduce((s, m) => s + m.gzipBytes, 0),
      budget_violations: violations.length,
      regressions: regressions.length,
    },
    chunks: Object.fromEntries(
      [...byTemplate.entries()].map(([tpl, m]) => [
        tpl,
        {
          rawBytes: m.rawBytes,
          gzipBytes: m.gzipBytes,
          category: m.category,
        },
      ]),
    ),
    violations,
    regressions,
  };

  if (UPDATE_BASELINE) {
    await writeFile(BASELINE_PATH, JSON.stringify(report, null, 2) + '\n');
    log(`Wrote baseline ${BASELINE_PATH}`);
    log(`Captured ${byTemplate.size} chunks, total ${(report.summary.total_gzip_bytes / 1024).toFixed(1)} kB gz`);
    return;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log(`📦 Bundle audit — ${byTemplate.size} chunks, ${(report.summary.total_gzip_bytes / 1024).toFixed(1)} kB gz total`);
  console.log('');
  console.log('Top 10 chunks by gzip size:');
  const sorted = [...byTemplate.values()].sort((a, b) => b.gzipBytes - a.gzipBytes);
  for (const m of sorted.slice(0, 10)) {
    const kb = (m.gzipBytes / 1024).toFixed(1);
    const rawKb = (m.rawBytes / 1024).toFixed(1);
    const budget = BUDGET[m.category] ?? BUDGET.lazy;
    const tag =
      m.gzipBytes > budget
        ? `⚠ over budget (${(budget / 1024).toFixed(0)} kB)`
        : '✓';
    console.log(`  ${tag} ${m.name.padEnd(45)} ${kb.padStart(7)} kB gz  (raw ${rawKb} kB)  [${m.category}]`);
  }
  console.log('');
  if (violations.length > 0) {
    console.log(`❌ ${violations.length} budget violation(s):`);
    for (const v of violations) {
      console.log(
        `   ${v.name}: ${(v.gzipBytes / 1024).toFixed(1)} kB > ${(v.budgetBytes / 1024).toFixed(0)} kB (over by ${(v.overBytes / 1024).toFixed(1)} kB)`,
      );
    }
  }
  if (regressions.length > 0) {
    console.log(`⚠ ${regressions.length} regression(s) vs baseline:`);
    for (const r of regressions) {
      console.log(
        `   ${r.template}: ${(r.baselineBytes / 1024).toFixed(1)} → ${(r.currentBytes / 1024).toFixed(1)} kB (+${r.growthPct.toFixed(1)}%)`,
      );
    }
  }
  if (violations.length === 0 && regressions.length === 0) {
    console.log('✅ All chunks within budget + no regressions vs baseline.');
  }

  // Exit code policy (ratchet-down model, same as WP 2.5 staleTime):
  //   - REGRESSIONS (>5 % growth vs baseline) fail the gate immediately
  //   - VIOLATIONS (over absolute budget) are reported but DO NOT fail —
  //     they represent known debt that ratchets down over time. New
  //     contributors don't get blocked for existing bloat.
  //   - The combined `npm run build` + this script is the canonical CI
  //     check. Adopt budgets as hard limits only after current debt
  //     drops below them.
  //
  // When TARGETING budget: pass `--strict` to fail on violations too.
  const strict = process.argv.includes('--strict');
  const failed = regressions.length > 0 || (strict && violations.length > 0);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('[bundle:FATAL]', err);
  process.exit(JSON_OUT ? 0 : 1);
});
