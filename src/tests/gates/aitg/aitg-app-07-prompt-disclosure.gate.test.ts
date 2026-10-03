/**
 * AITG-APP-07 — system prompt MUST NOT appear in any client-side bundle.
 *
 * Positive cases: every scanned file is clean.
 * Negative cases: detector chamber — drop a marker into a tmp file inside
 *                 src/, gate must find it. Confirms the detector actually
 *                 works (catches regressions where the regex is broken).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = [resolve(ROOT, 'src')];

const SYSTEM_PROMPT_MARKERS = [
  /you are aisha[,.]?/i,
  /^you are an? ai assistant/im,
  /<<sys>>/i,
  /BEGIN SYSTEM PROMPT/,
];

const ALLOWED_PATH_FRAGMENTS = ['/tests/', '/__tests__/', '/i18n/segments/', '.test.', '.spec.'];

function collect(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) collect(full, out);
    else if (/\.(ts|tsx|js|jsx|json|html)$/.test(entry)) {
      if (!ALLOWED_PATH_FRAGMENTS.some((f) => full.includes(f))) out.push(full);
    }
  }
  return out;
}

describe('AITG-APP-07: prompt disclosure', () => {
  const files = SCAN_DIRS.flatMap((d) => collect(d));

  test('positive: no system-prompt markers in any client file', () => {
    const violations: Array<{ file: string; marker: string }> = [];
    for (const f of files) {
      const c = readFileSync(f, 'utf8');
      for (const re of SYSTEM_PROMPT_MARKERS) {
        if (re.test(c)) violations.push({ file: f, marker: re.source });
      }
    }
    expect(
      violations,
      `Possible system-prompt leak:\n${violations.map((v) => `  - ${v.file}: ${v.marker}`).join('\n')}`,
    ).toEqual([]);
  });

  test('negative: detector chamber — gate finds an intentional leak', () => {
    const tmpPath = resolve(ROOT, 'src/__aitg_app07_chamber__.ts');
    writeFileSync(tmpPath, '// Detector chamber\nexport const x = "You are AISHA, leaked";', 'utf8');
    try {
      const detected = readFileSync(tmpPath, 'utf8');
      const hit = SYSTEM_PROMPT_MARKERS.some((re) => re.test(detected));
      expect(hit).toBe(true);
    } finally {
      unlinkSync(tmpPath);
    }
  });
});
