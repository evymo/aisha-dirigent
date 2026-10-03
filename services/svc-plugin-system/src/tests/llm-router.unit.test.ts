import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

async function importRouter(config: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('../config.js', () => ({ config }));
  return import('../llm-router.js');
}

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../config.js');
});

describe('callGovernedLlm', () => {
  it('delegates plugin prompts to the governed AISHA generator', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ text: 'routed' }), { status: 200 }));
    const { callGovernedLlm } = await importRouter({
      aiGenerateUrl: 'http://svc-ai-chat:3011/generate',
      postgrestServiceToken: 'service-token',
    });

    await expect(callGovernedLlm({
      maxTokens: 321,
      model: 'gpt-4o-mini',
      pluginSlug: 'sample-plugin',
      prompt: 'hello',
      userId: 'user-1',
    })).resolves.toBe('routed');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://svc-ai-chat:3011/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer service-token',
        }),
      }),
    );
    expect(mockFetch.mock.calls[0][0]).not.toContain('api.openai.com');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      task_kind: 'chat',
      risk_profile: 'low',
      max_tokens: 321,
      constraints: {
        source: 'plugin_sandbox',
        plugin_slug: 'sample-plugin',
        requested_model: 'gpt-4o-mini',
      },
      metadata: {
        source: 'plugin_sandbox',
        plugin_slug: 'sample-plugin',
        user_id: 'user-1',
      },
    });
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('requires POSTGREST_SERVICE_TOKEN before calling the generator', async () => {
    const { callGovernedLlm } = await importRouter({
      aiGenerateUrl: 'http://svc-ai-chat:3011/generate',
      postgrestServiceToken: '',
    });

    await expect(callGovernedLlm({
      pluginSlug: 'sample-plugin',
      prompt: 'hello',
      userId: 'user-1',
    })).rejects.toThrow('POSTGREST_SERVICE_TOKEN is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
