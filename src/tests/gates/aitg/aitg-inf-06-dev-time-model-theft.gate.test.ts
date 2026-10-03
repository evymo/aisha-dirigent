/**
 * AITG-INF-06 — Dev-Time Model Theft.
 *
 * Model weights (.gguf, .safetensors, .bin, .pt, .ckpt, .onnx) MUST NOT
 * be committed to the repo. They belong in a registry (Hugging Face,
 * private S3, model_registry table with hash).
 *
 * Implementation note (2026-05-18): use `git ls-files` as the source of
 * truth for "committed" rather than walking the filesystem. This honors
 * .gitignore implicitly — Python virtualenvs (`scripts/ai/.venv/`) ship
 * sentencepiece's `nfkc.bin` etc. but those are gitignored and must not
 * trigger this gate. Walking the filesystem produced false positives on
 * any workstation that ran a local venv. Going through git also matches
 * the test's stated semantics ("no COMMITTED file").
 */

import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const WEIGHTS_RE = /\.(gguf|safetensors|bin|pt|ckpt|onnx|h5|pb|tflite)$/i;

/**
 * Return repo-relative paths of every git-tracked file. Single subprocess
 * call (no per-file fork). Filtered by extension before stat(), so we
 * only stat the small subset of weight-suffixed paths.
 */
function listTrackedFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // -z gives NUL-separated entries → safe against filenames with newlines.
  return stdout.split('\0').filter((p) => p.length > 0);
}

function findCommittedWeights(): string[] {
  const tracked = listTrackedFiles();
  const candidates = tracked.filter((p) => WEIGHTS_RE.test(p));
  const offenders: string[] = [];
  for (const rel of candidates) {
    try {
      const s = statSync(resolve(ROOT, rel));
      // Some legitimate non-weight files match (e.g. random.pt that's a
      // Python script). Filter by size — model weights are typically MB+.
      if (s.size > 100_000) offenders.push(rel);
    } catch {
      /* file deleted between ls-files and stat — ignore */
    }
  }
  return offenders;
}

describe('AITG-INF-06: no model weights committed to repo', () => {
  test('negative: no committed file matches a weight extension AND is >100KB', () => {
    const offenders = findCommittedWeights();
    expect(
      offenders,
      `Possible model weights committed to repo:\n${offenders.map((o) => `  - ${o}`).join('\n')}`,
    ).toEqual([]);
  });

  test('positive: extension regex matches expected formats', () => {
    expect(WEIGHTS_RE.test('foo.gguf')).toBe(true);
    expect(WEIGHTS_RE.test('foo.safetensors')).toBe(true);
    expect(WEIGHTS_RE.test('foo.onnx')).toBe(true);
    expect(WEIGHTS_RE.test('foo.txt')).toBe(false);
    expect(WEIGHTS_RE.test('foo.json')).toBe(false);
  });
});
