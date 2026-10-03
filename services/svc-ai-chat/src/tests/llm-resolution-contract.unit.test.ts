/**
 * The canonical model→dispatch resolution contract of lib/llmRouter.ts — the SINGLE
 * router after the legacy lib/llm-router.ts was removed (its consumers had already been
 * consolidated onto llmRouter; this test + the deletion finish the job by locking the
 * behavior the duplicate can no longer silently diverge from).
 *
 * Two layers, both exercised here:
 *   resolveProvider(model)        — pure classification: model string → provider family.
 *   resolveAvailableModel(model)  — capability-availability ("uses what it has"): keep the
 *                                   preferred model when its provider is configured, else
 *                                   REMAP to a backend the instance actually has, so a run
 *                                   never fails merely because the default provider has no key.
 *
 * The legacy router classified non-cloud prefixes (docker-/ollama-/vllm-/gateway:/local-)
 * as openai/local — the divergence that broke the ai_decisions↔dispatch provider match.
 * Locking resolveProvider here makes that regression un-reintroducible.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { resolveProvider, resolveAvailableModel } from '../lib/llmRouter.js';

describe('resolveProvider — canonical model→provider classification (single router)', () => {
  it.each([
    // cloud / maestro — the production set today
    ['maestro-story-abc', 'maestro'],
    ['claude-sonnet-4', 'anthropic'],
    ['gemini-2.5-flash', 'google'],
    ['gpt-4o-mini', 'openai'],
    // non-cloud prefixes — the legacy mis-routed these to openai/local
    ['docker-mistral', 'docker'],
    ['ollama-neural', 'ollama'],
    ['vllm-zephyr', 'vllm'],
    ['gateway:gpt-4o', 'gateway'],
    ['llm-gateway:claude', 'gateway'],
    ['local-mistral', 'vllm'],
  ])('%s → %s', (model, expected) => {
    expect(resolveProvider(model)).toBe(expected);
  });
});

describe('resolveAvailableModel — capability-availability ("uses what it has")', () => {
  const backend = (id: string, prefix: string) => ({ id, canServe: (m: string) => m.startsWith(prefix) });
  // The remap target model is DERIVED (master-plan A3 deleted the BACKEND_FALLBACK_MODEL
  // constant): resolveAvailableModel reads each backend's DISCOVERED models, never a static
  // per-provider roster. Tests inject the discovered-model lookup tied to their fake backends.
  const discovered = (map: Record<string, string[]>): ((id: string) => readonly string[]) =>
    (id) => map[id] ?? [];

  it('keeps the preferred model when its provider IS configured (no remap)', () => {
    const backends = [backend('openai', 'gpt'), backend('anthropic', 'claude')];
    expect(resolveAvailableModel('gpt-4o', backends)).toEqual({ model: 'gpt-4o', provider: 'openai' });
  });

  it('REMAPS to a configured backend (DERIVED model) when the preferred provider is absent', () => {
    // anthropic-only instance asked for a gpt model → never dispatch to an unconfigured
    // openai; remap to the provider the instance actually has, with a model DISCOVERED for it.
    const backends = [backend('anthropic', 'claude')];
    const out = resolveAvailableModel('gpt-4o', backends, discovered({ anthropic: ['claude-x-discovered'] }));
    expect(out).toEqual({ model: 'claude-x-discovered', provider: 'anthropic' });
  });

  it('remaps to the FIRST configured backend (live registry order) that has a discovered model', () => {
    // gpt-4o served by neither; openai precedes vllm in the passed order → openai wins,
    // and its model is the one DISCOVERED for openai (not a hardcoded constant).
    const backends = [backend('openai', 'never-matches-xyz'), backend('vllm', 'vllm-')];
    const out = resolveAvailableModel('gpt-4o', backends, discovered({ openai: ['gpt-discovered'], vllm: ['vllm-x'] }));
    expect(out).toEqual({ model: 'gpt-discovered', provider: 'openai' });
  });

  it('keeps the preferred model when a provider is configured but NO model is discovered yet (no silent swap)', () => {
    // Configured backend exists but the registry has not discovered a concrete model →
    // keep the preferred so the downstream surfaces a clear error rather than inventing one.
    const backends = [backend('anthropic', 'claude')];
    expect(resolveAvailableModel('gpt-4o', backends, discovered({}))).toEqual({ model: 'gpt-4o', provider: 'openai' });
  });

  it('is a no-op when NOTHING is configured (empty registry → keep preferred)', () => {
    expect(resolveAvailableModel('gpt-4o', [])).toEqual({ model: 'gpt-4o', provider: 'openai' });
  });
});
