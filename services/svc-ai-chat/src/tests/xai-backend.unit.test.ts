/**
 * xAI (Grok) backend registration — mirrors how openai is registered.
 *
 * xAI exposes an OpenAI-compatible /v1 endpoint at api.x.ai/v1, so it reuses the
 * OpenAICompatBackend shape. Like every other provider it is registered ONLY when
 * its key (XAI_API_KEY) is present — createXAIBackend returns null otherwise — so a
 * process holding no key never advertises xai in selectServiceableSlugs() and the
 * resolver cannot pick it (capability-availability, not a roster).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { createXAIBackend } from '@aisha/llm-dispatch';
import { BackendRegistry } from '@aisha/llm-dispatch';

const ORIG = { XAI_API_KEY: process.env.XAI_API_KEY, XAI_BASE_URL: process.env.XAI_BASE_URL };

afterEach(() => {
  process.env.XAI_API_KEY = ORIG.XAI_API_KEY;
  process.env.XAI_BASE_URL = ORIG.XAI_BASE_URL;
});

describe('createXAIBackend — key-only registration gate (mirrors openai)', () => {
  it('returns null when XAI_API_KEY is absent (never registered without a key)', () => {
    delete process.env.XAI_API_KEY;
    expect(createXAIBackend()).toBeNull();
  });

  it('builds an OpenAI-compatible cloud backend when XAI_API_KEY is present', () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    delete process.env.XAI_BASE_URL;
    const backend = createXAIBackend();
    expect(backend).not.toBeNull();
    expect(backend!.id).toBe('xai');
    expect(backend!.kind).toBe('cloud');
    expect(backend!.supportsTools).toBe(true);
    // grok-* model ids resolve to this backend by prefix.
    expect(backend!.canServe('grok-2')).toBe(true);
    expect(backend!.canServe('gpt-4o')).toBe(false);
  });
});

describe('BackendRegistry — registers xai when keyed', () => {
  beforeEach(() => {
    // Isolate: only XAI configured so the registry surfaces exactly the xai backend.
    for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OLLAMA_URL',
      'DOCKER_MODEL_RUNNER_URL', 'VLLM_GENERATION_URL', 'MAESTRO_URL',
      'AISHA_LLM_GATEWAY_URL', 'AISHA_LLM_GATEWAY_KEY']) {
      delete process.env[k];
    }
  });

  it('the xai backend appears in getAllBackends() when XAI_API_KEY is set', () => {
    process.env.XAI_API_KEY = 'xai-test-key';
    const reg = new BackendRegistry();
    reg.initialize();
    expect(reg.getAllBackends().some((b) => b.id === 'xai')).toBe(true);
  });

  it('the xai backend is ABSENT when no key is configured', () => {
    delete process.env.XAI_API_KEY;
    const reg = new BackendRegistry();
    reg.initialize();
    expect(reg.getAllBackends().some((b) => b.id === 'xai')).toBe(false);
  });
});
