/**
 * Unit tests for llm-completion (Step 0 of optimization plan 2026).
 *
 * Scope: contract + retry + URL/key resolution. No live LLM calls.
 *
 * Why this matters: chatCompletion is called from BOTH judge metrics and (in
 * Step 1) the contextual-prefix worker. A retry-loop bug that mis-classifies
 * a 4xx as retryable would burn token budget and rate-limit the provider.
 * A retry-loop bug that gives up on a transient 502 would corrupt eval
 * baselines (failed runs leak into the average). Tests pin both behaviors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatCompletion, chatCompletionWithRetry, LlmCompletionError } from '../lib/llm-completion.js';

vi.mock('../config.js', () => ({
  config: {
    openaiApiKey: 'cfg-default-key',
  },
}));

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

describe('llm-completion — base URL + API key resolution', () => {
  beforeEach(() => {
    delete process.env.RAG_JUDGE_BASE_URL;
    delete process.env.VLLM_GENERATION_URL;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.RAG_JUDGE_API_KEY;
    delete process.env.VLLM_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers explicit base_url override above all env vars', async () => {
    process.env.RAG_JUDGE_BASE_URL = 'http://judge.test/v1';
    process.env.VLLM_GENERATION_URL = 'http://vllm.test/v1';
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: 'm',
      }));
    await chatCompletion({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      base_url: 'http://explicit.test/v2',
      api_key: 'explicit-key',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://explicit.test/v2/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer explicit-key' }),
      }),
    );
    fetchMock.mockRestore();
  });

  it('falls back through env vars: RAG_JUDGE_BASE_URL > VLLM_GENERATION_URL > OPENAI_API_BASE_URL', async () => {
    process.env.VLLM_GENERATION_URL = 'http://vllm.test/v1';
    process.env.OPENAI_API_BASE_URL = 'http://openai.test/v1';
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: 'm',
      }));
    await chatCompletion({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      api_key: 'k',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://vllm.test/v1/chat/completions',
      expect.any(Object),
    );
    fetchMock.mockRestore();
  });

  it('throws 503 when no API key resolvable (no env, no config, no override)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    // override config to empty
    vi.doMock('../config.js', () => ({ config: { openaiApiKey: '' } }));
    vi.resetModules();
    // Re-import BOTH chatCompletion AND LlmCompletionError from the same module
    // identity — after resetModules, the class identity changes, so the original
    // top-of-file import would fail instanceof.
    const reloaded = await import('../lib/llm-completion.js');
    const { chatCompletion: cc, LlmCompletionError: LlmErr } = reloaded;

    await expect(
      cc({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(LlmErr);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});

// ⛔ KLÍČ JEN SVÉMU POSKYTOVATELI (naměřeno 2026-09-28 nad upstream main).
// Safety scan (a graph-extract, rag-eval, soudci) předával `api_key`, ale ne
// `auth_env_var`. Klient bral neuvedené prohlášení jako „klíč nutný“ a sáhl po
// řetězu RAG_JUDGE_API_KEY → VLLM_API_KEY → OPENAI_API_KEY — cizí pověření
// odešlo jako Bearer na endpoint resolveru, včetně LOKÁLNÍHO model serveru.
// Mock config nese `cfg-default-key` = cizí (OpenAI) klíč, který nikam jinam
// odejít nesmí.
describe('llm-completion — klíč jen svému poskytovateli', () => {
  const ok = () => jsonResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    model: 'm',
  });
  const hlavicky = (fetchMock: { mock: { calls: unknown[][] } }) =>
    ((fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit).headers as Record<string, string>;
  const msg = [{ role: 'user' as const, content: 'hi' }];

  beforeEach(() => {
    delete process.env.RAG_JUDGE_BASE_URL;
    delete process.env.VLLM_GENERATION_URL;
    delete process.env.OPENAI_API_BASE_URL;
    delete process.env.RAG_JUDGE_API_KEY;
    delete process.env.VLLM_API_KEY;
    delete process.env.MISTRAL_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('backend bez autentizace (auth_env_var: null) → žádná hlavička Authorization', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await chatCompletion({ model: 'm', messages: msg, base_url: 'http://model.local:8000/v1', auth_env_var: null });
    expect(hlavicky(fetchMock).Authorization).toBeUndefined();
  });

  it('prohlášená proměnná chybí → 503, cizí klíč se NEDOSADÍ a nic neodejde', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await expect(
      chatCompletion({ model: 'm', messages: msg, base_url: 'https://api.mistral.example/v1', auth_env_var: 'MISTRAL_API_KEY' }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prohlášená proměnná je → jde právě ona', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await chatCompletion({ model: 'm', messages: msg, base_url: 'https://api.mistral.example/v1', auth_env_var: 'MISTRAL_API_KEY' });
    expect(hlavicky(fetchMock).Authorization).toBe('Bearer mistral-key');
  });

  it('endpoint od volajícího bez prohlášení i bez klíče → 503, cizí klíč neodejde', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await expect(
      chatCompletion({ model: 'm', messages: msg, base_url: 'http://model.local:8000/v1', provider_slug: 'local_vllm' }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('endpoint z VLLM_GENERATION_URL bez VLLM_API_KEY → bez hlavičky, ne s klíčem OpenAI', async () => {
    process.env.VLLM_GENERATION_URL = 'http://vllm.local:8000/v1';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await chatCompletion({ model: 'm', messages: msg });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://vllm.local:8000/v1/chat/completions');
    expect(hlavicky(fetchMock).Authorization).toBeUndefined();
  });

  it('endpoint z VLLM_GENERATION_URL nedostane klíč soudce (RAG_JUDGE_API_KEY patří k RAG_JUDGE_BASE_URL)', async () => {
    process.env.VLLM_GENERATION_URL = 'http://vllm.local:8000/v1';
    process.env.RAG_JUDGE_API_KEY = 'judge-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await chatCompletion({ model: 'm', messages: msg });
    expect(hlavicky(fetchMock).Authorization).toBeUndefined();
  });

  it('endpoint soudce z RAG_JUDGE_BASE_URL dostane svůj RAG_JUDGE_API_KEY', async () => {
    process.env.RAG_JUDGE_BASE_URL = 'https://judge.example/v1';
    process.env.RAG_JUDGE_API_KEY = 'judge-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await chatCompletion({ model: 'm', messages: msg });
    expect(hlavicky(fetchMock).Authorization).toBe('Bearer judge-key');
  });

  it('endpoint z OPENAI_API_BASE_URL dostane klíč OpenAI (tam patří)', async () => {
    process.env.OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await chatCompletion({ model: 'm', messages: msg });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(hlavicky(fetchMock).Authorization).toBe('Bearer cfg-default-key');
  });

  it('žádný deklarovaný endpoint → 503, nic se nedosadí a nic neodejde', async () => {
    // Pravidlo „žádné fallbacky“: dřív tu klient tiše volal api.openai.com.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await expect(chatCompletion({ model: 'm', messages: msg })).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nativní poskytovatel bez prohlášení i klíče → 503, klíč OpenAI se mu nepošle', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await expect(
      chatCompletion({ model: 'gemini-x', messages: msg, provider_slug: 'google-genai' }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Třída, ne jeden výskyt: KAŽDÉ volání chatCompletion/chatCompletionWithRetry
// ve zdrojích služby předává prohlášení `auth_env_var` backendu, ze kterého
// endpoint pochází. Nové volání bez něj = nález (tady vznikla díra ve 4 místech).
describe('llm-completion — každé volání nese auth_env_var', () => {
  it('ve zdrojích (mimo testy) nechybí u žádného volání', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    const soubory: string[] = [];
    const projdi = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { if (n !== 'tests') projdi(p); }
        else if (p.endsWith('.ts') && !p.endsWith('llm-completion.ts')) soubory.push(p);
      }
    };
    projdi(src);
    const bezProhlaseni: string[] = [];
    let volani = 0;
    for (const f of soubory) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/chatCompletion(?:WithRetry)?\(\s*\{/g)) {
        volani++;
        // Objekt argumentu až po odpovídající `}` (počítání závorek).
        let i = (m.index ?? 0) + m[0].length;
        let hloubka = 1;
        while (i < text.length && hloubka > 0) {
          if (text[i] === '{') hloubka++;
          else if (text[i] === '}') hloubka--;
          i++;
        }
        const argument = text.slice(m.index, i);
        if (!/\bauth_env_var\s*[:,}]/.test(argument)) {
          bezProhlaseni.push(`${f.slice(src.length + 1)}:${text.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(volani, 'měřidlo nic nenašlo — změnil se tvar volání?').toBeGreaterThanOrEqual(4);
    expect(bezProhlaseni).toEqual([]);
  });
});

describe('llm-completion — HTTP contract', () => {
  beforeEach(() => {
    process.env.RAG_JUDGE_API_KEY = 'test-key';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('sets json_mode → response_format=json_object in body', async () => {
    let captured: { body?: string } | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      captured = init as { body?: string };
      return jsonResponse({
        choices: [{ message: { content: '{"score":0.9}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        model: 'm',
      });
    });
    await chatCompletion({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
      json_mode: true,
      api_key: 'k',
      base_url: 'http://t/v1',
    });
    expect(captured).not.toBeNull();
    const body = JSON.parse(captured!.body!);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0);
  });

  it('maps non-2xx responses to LlmCompletionError with status preserved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('rate limited', 429));
    try {
      await chatCompletion({
        model: 'm',
        messages: [{ role: 'user', content: 'q' }],
        api_key: 'k',
        base_url: 'http://t/v1',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmCompletionError);
      expect((err as LlmCompletionError).statusCode).toBe(429);
    }
  });

  it('maps fetch network error to LlmCompletionError 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    try {
      await chatCompletion({
        model: 'm',
        messages: [{ role: 'user', content: 'q' }],
        api_key: 'k',
        base_url: 'http://t/v1',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmCompletionError);
      expect((err as LlmCompletionError).statusCode).toBe(502);
    }
  });

  it('rejects malformed response (no choices[0].message.content)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: {} }],
      usage: {},
    }));
    await expect(
      chatCompletion({
        model: 'm',
        messages: [{ role: 'user', content: 'q' }],
        api_key: 'k',
        base_url: 'http://t/v1',
      }),
    ).rejects.toThrow(/no choices\[0\]\.message\.content/);
  });
});

describe('llm-completion — chatCompletionWithRetry', () => {
  beforeEach(() => {
    process.env.RAG_JUDGE_API_KEY = 'test-key';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('retries on 502/503/504/429 then succeeds', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      if (calls < 3) return textResponse('upstream slow', 503);
      return jsonResponse({
        choices: [{ message: { content: 'final' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: 'm',
      });
    });
    const result = await chatCompletionWithRetry(
      {
        model: 'm',
        messages: [{ role: 'user', content: 'q' }],
        api_key: 'k',
        base_url: 'http://t/v1',
      },
      3,
      1, // 1ms backoff for fast test
    );
    expect(result.text).toBe('final');
    expect(calls).toBe(3);
  });

  it('does NOT retry on 4xx (caller mistake — retry would waste budget)', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      return textResponse('bad request', 400);
    });
    await expect(
      chatCompletionWithRetry(
        {
          model: 'm',
          messages: [{ role: 'user', content: 'q' }],
          api_key: 'k',
          base_url: 'http://t/v1',
        },
        3,
        1,
      ),
    ).rejects.toThrow(LlmCompletionError);
    expect(calls).toBe(1);
  });

  it('exhausts attempts then throws last error', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      return textResponse('still slow', 503);
    });
    await expect(
      chatCompletionWithRetry(
        {
          model: 'm',
          messages: [{ role: 'user', content: 'q' }],
          api_key: 'k',
          base_url: 'http://t/v1',
        },
        3,
        1,
      ),
    ).rejects.toThrow(LlmCompletionError);
    expect(calls).toBe(3);
  });
});

/**
 * Native-protocol dispatch — the fix for the RAG completion plane's 404 bug.
 *
 * THE BUG: every caller POSTed `${base_url}/chat/completions` with no backend_kind
 * branching. A resolver-chosen native-protocol provider (google-genai, anthropic) has
 * NO such endpoint → 404 → contextual prefixes (and thus embeddings) silently never
 * generated. THE FIX: chatCompletion() branches on the resolver-supplied provider_slug
 * and dispatches native-protocol providers through @aisha/llm-dispatch's
 * GeminiBackend / AnthropicBackend (real Gemini :generateContent, Anthropic /v1/messages).
 *
 * The REAL chatCompletion is the unit under test — only fetch is mocked, so the native
 * backends construct their real URLs/headers. The `not.toContain('/chat/completions')`
 * assertions are the regression guard against the 404. provider_slug is always
 * resolver-supplied — see [[feedback_aisha_selects_no_model_defaults]].
 */
describe('llm-completion — native-protocol dispatch (google-genai / anthropic)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('google-genai → Gemini :generateContent, NOT /chat/completions (the 404 fix)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: 'ok from gemini' }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    }));
    const result = await chatCompletion({
      provider_slug: 'google-genai',
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      api_key: 'sk-test',
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('https://generativelanguage.googleapis.com');
    expect(url).toContain('/models/gemini-2.0-flash:generateContent');
    expect(url).not.toContain('/chat/completions'); // ← regression guard for the 404
    // Native ChatResponse mapped back to the OpenAI-compat CompletionResult contract.
    expect(result.text).toBe('ok from gemini');
    expect(result.model).toBe('gemini-2.0-flash');
    expect(result.usage.prompt_tokens).toBe(7);
    expect(result.usage.completion_tokens).toBe(3);
    expect(result.usage.total_tokens).toBe(10);
    fetchMock.mockRestore();
  });

  it('anthropic → /v1/messages with x-api-key, NOT /chat/completions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      content: [{ type: 'text', text: 'ok from anthropic' }],
      usage: { input_tokens: 7, output_tokens: 3 },
      stop_reason: 'end_turn',
    }));
    const result = await chatCompletion({
      provider_slug: 'anthropic',
      model: 'claude-sonnet-4',
      // A system turn must be lifted to Anthropic's top-level `system` field, not a message.
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      api_key: 'sk-test',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(String(url)).not.toContain('/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBeTruthy();
    expect(headers['Authorization']).toBeUndefined(); // native auth, not OpenAI Bearer
    expect(result.text).toBe('ok from anthropic');
    expect(result.usage.total_tokens).toBe(10);
    fetchMock.mockRestore();
  });

  it('native path with no resolvable API key THROWS (fail-loud, fetch never called)', async () => {
    process.env.RAG_JUDGE_API_KEY = ''; // '' short-circuits resolveApiKey → no key
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(
      chatCompletion({
        provider_slug: 'anthropic',
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(LlmCompletionError);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('non-native provider_slug (openai) keeps the /chat/completions Bearer path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: { content: 'ok from openai' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      model: 'gpt-4o',
    }));
    await chatCompletion({
      provider_slug: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      api_key: 'sk-test',
      base_url: 'https://api.openai.com/v1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    fetchMock.mockRestore();
  });

  it('unrecognized provider_slug also falls through to /chat/completions (back-compat)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: 'deepseek-chat',
    }));
    await chatCompletion({
      provider_slug: 'deepseek', // OpenAI-compat, not native-protocol
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      api_key: 'sk-test',
      base_url: 'https://api.deepseek.com/v1',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions');
    fetchMock.mockRestore();
  });
});
