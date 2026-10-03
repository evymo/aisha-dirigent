/**
 * Capability-availability model resolution (infra contract).
 *
 * AISHA must self-function with WHICHEVER provider is configured: the reflection
 * default path expresses a slot PREFERENCE, then resolveAvailableModel remaps it
 * to a provider whose backend is actually registered (i.e. has a key) — derived
 * from the registry, not a hardcoded single-provider default. This locks that the
 * preferred provider is kept when present and gracefully remapped when absent.
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

import { resolveAvailableModel, selectServiceableSlugs, resolveProvider } from '../lib/llmRouter.js';

const backend = (id: string, prefixes: string[]) => ({
  id,
  canServe: (m: string) => prefixes.some((p) => m.toLowerCase().startsWith(p)),
});
const ANTHROPIC = backend('anthropic', ['claude']);
const OPENAI = backend('openai', ['gpt']);
const GOOGLE = backend('google', ['gemini']);
const XAI = backend('xai', ['grok']);

// The remap target is DERIVED from each configured backend's DISCOVERED models
// (capability-availability), not a hardcoded roster — so a remap test must mock the
// discovered-model lookup (resolveAvailableModel's 3rd param). In production these
// come from the live registry populated by discoverModels(); here we inject the same
// per-backend lists a real probe would have found.
const discovered = (byBackend: Record<string, readonly string[]>) =>
  (id: string): readonly string[] => byBackend[id] ?? [];

// Realistic discovered chat-capable models per provider (first entry = first
// chat-capable → the remap target). The lists deliberately also contain non-chat
// ids first for openai to prove the remap skips them.
const DISCOVERED = discovered({
  openai: ['text-embedding-3-small', 'tts-1', 'gpt-4o-mini', 'gpt-4o'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  xai: ['grok-2', 'grok-4'],
});

describe('resolveAvailableModel — capability-availability', () => {
  it('keeps the preferred model when its provider IS configured', () => {
    expect(resolveAvailableModel('claude-sonnet-4', [ANTHROPIC, OPENAI], DISCOVERED)).toEqual({
      model: 'claude-sonnet-4',
      provider: 'anthropic',
    });
  });

  it('remaps to the configured provider FIRST CHAT-CAPABLE discovered model when the preferred one is absent (the design fix)', () => {
    // claude preferred but only OpenAI configured → self-route to OpenAI, picking the
    // first chat-capable discovered id (the embedding/tts entries are SKIPPED).
    expect(resolveAvailableModel('claude-sonnet-4', [OPENAI], DISCOVERED)).toEqual({
      model: 'gpt-4o-mini',
      provider: 'openai',
    });
  });

  it('remaps to google first chat-capable discovered model when only google is configured', () => {
    expect(resolveAvailableModel('claude-haiku-4-20250514', [GOOGLE], DISCOVERED)).toEqual({
      model: 'gemini-2.5-flash',
      provider: 'google',
    });
  });

  it('prefers the cloud order (openai before google) when several non-preferred providers exist', () => {
    expect(resolveAvailableModel('claude-sonnet-4', [GOOGLE, OPENAI], DISCOVERED).provider).toBe('openai');
  });

  it('skips a backend whose discovered models are ALL non-chat and remaps to the next chat-capable one', () => {
    // openai discovered only an embedding model (no chat) → skip openai, fall through
    // to google's chat-capable discovered model. No silent chat-remap onto an embedding.
    const ONLY_EMBEDDING = discovered({
      openai: ['text-embedding-3-small'],
      google: ['gemini-2.5-flash'],
    });
    expect(resolveAvailableModel('claude-sonnet-4', [OPENAI, GOOGLE], ONLY_EMBEDDING)).toEqual({
      model: 'gemini-2.5-flash',
      provider: 'google',
    });
  });

  it('keeps the preferred model when a configured backend has NO chat-capable discovered model anywhere (fail-loud, no invented model)', () => {
    // Cold process: openai configured but only a non-chat model discovered, nothing
    // else → keep the preferred model so the backend surfaces a clear error.
    const ONLY_EMBEDDING = discovered({ openai: ['text-embedding-3-small'] });
    expect(resolveAvailableModel('claude-sonnet-4', [OPENAI], ONLY_EMBEDDING)).toEqual({
      model: 'claude-sonnet-4',
      provider: 'anthropic',
    });
  });

  it('keeps the preferred model when NOTHING is configured (clear downstream error, no silent swap)', () => {
    expect(resolveAvailableModel('claude-sonnet-4', [], DISCOVERED)).toEqual({
      model: 'claude-sonnet-4',
      provider: 'anthropic',
    });
  });
});

// Both run loops route their resolved model through resolveAvailableModel: the
// reflection loop (decision.ts) and the workflowEngine loop (orchestrationBridge
// selectOptimalModel). These lock the workflowEngine's actual tier defaults.
describe('workflowEngine tier defaults — capability-availability', () => {
  it('keeps each tier model when its provider IS configured', () => {
    expect(resolveAvailableModel('claude-sonnet-4-20250514', [ANTHROPIC]).provider).toBe('anthropic');
    expect(resolveAvailableModel('gpt-5-mini', [OPENAI]).provider).toBe('openai');
    expect(resolveAvailableModel('gemini-2.5-flash', [GOOGLE]).provider).toBe('google');
  });

  it('remaps the claude-sonnet-4 complex/deep tier to OpenAI first chat-capable discovered model when only OpenAI is configured', () => {
    // MODEL_TIER_COMPLEX/DEEP default to claude-sonnet-4 — with only an OpenAI key
    // the workflowEngine must self-route to OpenAI's first chat-capable discovered
    // model instead of failing on a missing provider.
    expect(resolveAvailableModel('claude-sonnet-4-20250514', [OPENAI], DISCOVERED)).toEqual({
      model: 'gpt-4o-mini',
      provider: 'openai',
    });
  });
});

// The serviceability axis the DB resolver (aisha_resolve_clow_backend) intersects:
// which provider slugs THIS process can actually serve, derived from the live
// backend registry (a backend exists only when its key/endpoint is configured).
describe('selectServiceableSlugs — runtime key/endpoint truth → registry slugs', () => {
  it('maps configured backends to their provider-registry slugs (normalizing google/vllm/ollama/gateway)', () => {
    expect(
      selectServiceableSlugs([{ id: 'openai' }, { id: 'google' }, { id: 'vllm' }, { id: 'gateway' }]).sort(),
    ).toEqual(['google-genai', 'llm-gateway', 'openai', 'vllm-local']);
  });

  it('is empty when nothing is configured (→ resolver loud-fails, never substitutes)', () => {
    expect(selectServiceableSlugs([])).toEqual([]);
  });

  it('passes an unknown backend id through unchanged (no roster gate)', () => {
    expect(selectServiceableSlugs([{ id: 'some-future-provider' }])).toEqual(['some-future-provider']);
  });

  it('maps the xai backend to the xai provider-registry slug (mirrors openai — id==slug)', () => {
    expect(selectServiceableSlugs([{ id: 'xai' }])).toEqual(['xai']);
  });
});

// xAI (Grok) — registered exactly like the other direct cloud providers.
describe('xAI (Grok) provider wiring', () => {
  it('resolveProvider routes grok-* model ids to the xai provider', () => {
    expect(resolveProvider('grok-2')).toBe('xai');
    expect(resolveProvider('grok-4-reasoning')).toBe('xai');
    // non-grok ids are untouched (openai default, anthropic, google).
    expect(resolveProvider('gpt-4o')).toBe('openai');
    expect(resolveProvider('claude-sonnet-4')).toBe('anthropic');
  });

  it('keeps a grok model when the xai backend IS configured', () => {
    expect(resolveAvailableModel('grok-2', [XAI, OPENAI], DISCOVERED)).toEqual({ model: 'grok-2', provider: 'xai' });
  });

  it('remaps to xai first chat-capable discovered model when it is the only configured backend for a non-grok preferred model', () => {
    expect(resolveAvailableModel('claude-sonnet-4', [XAI], DISCOVERED)).toEqual({ model: 'grok-2', provider: 'xai' });
  });
});
