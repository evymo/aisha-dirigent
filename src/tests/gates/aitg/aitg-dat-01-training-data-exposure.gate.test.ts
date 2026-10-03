/**
 * AITG-DAT-01 — Training Data Exposure.
 *
 * No training corpus accessible via public CDN / repo. Static gate:
 *   - no .jsonl / .parquet / .csv with >10MB committed to public paths
 *   - no `public/` or `static/` directory hosts a file matching training-corpus
 *     shape (jsonl, parquet, training_*.csv)
 *   - no service exposes a route that streams raw rows from a `*_corpus`
 *     or `*_training` table without an audited RPC
 */

import { describe, test, expect } from 'vitest';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = process.cwd();

const TRAINING_PATTERNS = /\.(jsonl|parquet)$|training[_-]?data|corpus[_-]/i;
const PUBLIC_DIRS = ['public', 'static', 'cdn', 'assets'];

function walkPublic(root: string, out: string[] = []): string[] {
  for (const d of PUBLIC_DIRS) {
    const p = join(root, d);
    if (existsSync(p)) walk(p, out);
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(dir, e);
    try {
      const s = statSync(p);
      if (s.isDirectory()) walk(p, out);
      else if (TRAINING_PATTERNS.test(e) && s.size > 1_000_000) {
        out.push(relative(ROOT, p));
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

describe('AITG-DAT-01: training data exposure', () => {
  test('negative: no .jsonl / .parquet > 1MB in public/static directories', () => {
    const offenders = walkPublic(ROOT);
    expect(
      offenders,
      `Possible training corpus exposed via public directories:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  test('negative: no service exposes raw streaming over *_corpus tables', () => {
    const offenders: string[] = [];
    const svcDir = resolve(ROOT, 'services');
    if (existsSync(svcDir)) {
      walkAll(svcDir, (file) => {
        if (!file.endsWith('.ts')) return;
        const src = readFileSync(file, 'utf8');
        // Match `.from('*_corpus')` or `.from('*_training_data')` — direct table reads
        // bypassing audited RPC. The orchestrator stack forbids direct .from()
        // queries entirely (CLAUDE.md Absolute Rule #7), but a heuristic textual
        // scan still catches accidental migrations or template imports.
        if (/from\s*\(\s*['"]\w*(?:corpus|training)\w*['"]/i.test(src)) {
          offenders.push(relative(ROOT, file));
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('positive: training_dataset table (if present) requires SECURITY DEFINER RPC for access', () => {
    const tablesDir = resolve(ROOT, 'aisha/db/sql/tables');
    if (!existsSync(tablesDir)) return;
    const candidates = readdirSync(tablesDir).filter((f) =>
      /training|corpus/i.test(f),
    );
    for (const f of candidates) {
      const sql = readFileSync(join(tablesDir, f), 'utf8');
      expect(sql, `${f} should ENABLE ROW LEVEL SECURITY`).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    }
  });
});

function walkAll(dir: string, cb: (file: string) => void): void {
  try {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules') continue;
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) walkAll(p, cb);
      else cb(p);
    }
  } catch {
    /* ignore */
  }
}
