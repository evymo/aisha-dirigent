/**
 * Unit tests for contextual-prefix (Step 1 of optimization plan 2026).
 *
 * Scope: prompt template construction (incl. Brick4 locale-aware language clause)
 * + LLM call glue + fail-loud behaviour. The model is ALWAYS resolver-supplied
 * (opts.model) — there is no hardcoded/env default — and a failed/empty completion
 * THROWS so the caller re-queues rather than embedding a chunk without its prefix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCompletion = vi.hoisted(() => vi.fn());

vi.mock('../lib/llm-completion.js', () => ({
  chatCompletionWithRetry: mockCompletion,
  LlmCompletionError: class extends Error {
    statusCode: number;
    constructor(status: number, message: string) {
      super(message);
      this.statusCode = status;
    }
  },
}));

import { buildPrefixPrompt, generateContextualPrefix, localeLanguageName } from '../lib/contextual-prefix.js';

// Every real call resolves a model first; tests supply it explicitly.
const MODEL = { model: 'resolver-picked-model' };

beforeEach(() => {
  mockCompletion.mockReset();
});

describe('buildPrefixPrompt', () => {
  it('includes title, section, and chunk text in the user prompt', () => {
    const { system, user } = buildPrefixPrompt({
      item_title: 'Contract CS-2024-082',
      item_body_markdown: 'Smlouva mezi Acme s.r.o. a Klient X. § Reklamace …',
      section_title: 'Reklamace',
      chunk_text: 'Lhůta na reklamaci je 14 dní od převzetí.',
    });
    expect(user).toContain('Contract CS-2024-082');
    expect(user).toContain('Section: Reklamace');
    expect(user).toContain('Lhůta na reklamaci je 14 dní od převzetí.');
    expect(system).toMatch(/1–2 sentence context/);
    expect(system).toMatch(/Return ONLY the context sentence/);
  });

  it('falls back to "main" section label when section_title is null', () => {
    const { user } = buildPrefixPrompt({
      item_title: 'Document',
      item_body_markdown: 'body',
      section_title: null,
      chunk_text: 'chunk',
    });
    expect(user).toContain('Section: main');
  });

  it('truncates very long body_markdown to default excerpt size', () => {
    const longBody = 'X'.repeat(20_000);
    const { user } = buildPrefixPrompt({
      item_title: 'T',
      item_body_markdown: longBody,
      section_title: null,
      chunk_text: 'chunk',
    });
    expect(user).toMatch(/truncated to 6000 chars/);
    expect(user.includes('X'.repeat(6001))).toBe(false);
  });

  it('honors body_excerpt_chars override', () => {
    const longBody = 'Y'.repeat(20_000);
    const { user } = buildPrefixPrompt(
      { item_title: 'T', item_body_markdown: longBody, section_title: null, chunk_text: 'c' },
      { body_excerpt_chars: 1000 },
    );
    expect(user).toMatch(/truncated to 1000 chars/);
    expect(user.includes('Y'.repeat(1001))).toBe(false);
  });

  // ── Brick4: locale-aware language clause ──────────────────────────────────
  it('instructs the model to write the context in the chunk language (locale=cs)', () => {
    const { system } = buildPrefixPrompt({
      item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c', locale: 'cs',
    });
    expect(system).toMatch(/in Czech/);
    expect(system).toMatch(/never translate to another language/);
  });

  it('adds NO language clause for the global sentinel (English-default, back-compat)', () => {
    const { system } = buildPrefixPrompt({
      item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c', locale: 'global',
    });
    expect(system).not.toMatch(/the chunk's language/);
  });

  it('adds NO language clause when locale is omitted', () => {
    const { system } = buildPrefixPrompt({
      item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c',
    });
    expect(system).not.toMatch(/the chunk's language/);
  });

  it('adds NO language clause for an unresolvable locale code', () => {
    const { system } = buildPrefixPrompt({
      item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c', locale: 'zz',
    });
    expect(system).not.toMatch(/the chunk's language/);
  });
});

describe('localeLanguageName', () => {
  it('resolves known BCP47 codes to English language names', () => {
    expect(localeLanguageName('cs')).toBe('Czech');
    expect(localeLanguageName('de')).toBe('German');
  });
  it('returns null for global / empty / unknown', () => {
    expect(localeLanguageName('global')).toBeNull();
    expect(localeLanguageName('')).toBeNull();
    expect(localeLanguageName(undefined)).toBeNull();
    expect(localeLanguageName('zz')).toBeNull();
  });
});

describe('generateContextualPrefix — happy path', () => {
  it('returns trimmed prefix + model + token count from LLM', async () => {
    mockCompletion.mockResolvedValueOnce({
      text: '   This chunk discusses reclamation rules under contract CS-2024-082 with client Acme.   ',
      usage: { total_tokens: 85, prompt_tokens: 70, completion_tokens: 15 },
      latency_ms: 220,
      model: 'resolver-picked-model',
      finish_reason: 'stop',
    });

    const result = await generateContextualPrefix({
      item_title: 'Contract CS-2024-082',
      item_body_markdown: 'body',
      section_title: 'Reclamation',
      chunk_text: 'Lhůta 14 dní',
    }, MODEL);

    expect(result.prefix).toBe('This chunk discusses reclamation rules under contract CS-2024-082 with client Acme.');
    expect(result.model).toBe('resolver-picked-model');
    expect(result.token_count).toBe(85);
    expect(result.latency_ms).toBe(220);
  });

  it('calls the LLM with the resolver-supplied model (no env/default involved)', async () => {
    mockCompletion.mockResolvedValueOnce({
      text: 'ctx', usage: { total_tokens: 10, prompt_tokens: 8, completion_tokens: 2 },
      latency_ms: 50, model: 'custom-7b', finish_reason: 'stop',
    });
    await generateContextualPrefix(
      { item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c' },
      { model: 'custom-7b' },
    );
    expect(mockCompletion).toHaveBeenCalledWith(expect.objectContaining({ model: 'custom-7b', temperature: 0 }));
  });

  it('pins the audit model_version from opts.model_version', async () => {
    mockCompletion.mockResolvedValueOnce({
      text: 'ctx', usage: { total_tokens: 10, prompt_tokens: 8, completion_tokens: 2 },
      latency_ms: 50, model: 'resolver-picked-model', finish_reason: 'stop',
    });
    const result = await generateContextualPrefix(
      { item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c' },
      { ...MODEL, model_version: '2026-05-18-v3' },
    );
    expect(result.model_version).toBe('2026-05-18-v3');
  });
});

describe('generateContextualPrefix — fail-loud (HARD invariant)', () => {
  it('THROWS when no model is supplied (no hardcoded default — AISHA must resolve)', async () => {
    await expect(
      generateContextualPrefix({ item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c' }),
    ).rejects.toThrow(/opts\.model is required/);
    expect(mockCompletion).not.toHaveBeenCalled();
  });

  it('THROWS when the LLM fails (caller marks the item failed; never embeds prefix-less)', async () => {
    const errClass = (await import('../lib/llm-completion.js')).LlmCompletionError;
    mockCompletion.mockRejectedValueOnce(new errClass(503, 'vLLM down'));
    await expect(
      generateContextualPrefix({ item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c' }, MODEL),
    ).rejects.toThrow('vLLM down');
  });

  it('THROWS when the LLM returns empty/whitespace text', async () => {
    mockCompletion.mockResolvedValueOnce({
      text: '   \n  \t  ', usage: { total_tokens: 5, prompt_tokens: 5, completion_tokens: 0 },
      latency_ms: 30, model: 'resolver-picked-model', finish_reason: 'stop',
    });
    await expect(
      generateContextualPrefix({ item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c' }, MODEL),
    ).rejects.toThrow(/empty completion/);
  });

  it('propagates non-LLM exceptions (caller records a real failure)', async () => {
    mockCompletion.mockRejectedValueOnce(new TypeError('unexpected'));
    await expect(
      generateContextualPrefix({ item_title: 'T', item_body_markdown: 'b', section_title: null, chunk_text: 'c' }, MODEL),
    ).rejects.toThrow(TypeError);
  });
});
