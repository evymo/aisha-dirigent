/**
 * Hodnocení jedné odpovědi (lib/messageEvaluation.ts) a vzorkování (lib/evalSampleRate.ts) — K-17.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcService, mockUnifiedChat } = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockUnifiedChat: vi.fn(),
}));

vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));
vi.mock('../lib/llmRouter.js', () => ({ unifiedChat: mockUnifiedChat }));
vi.mock('../lib/governedOrchestration.js', () => ({
  detectDataSensitivity: () => ({ sensitivity: 'normal' }),
  auditResidencyVerdict: () => undefined,
}));
vi.mock('../lib/dispatchJournal.js', () => ({ journalDispatch: async () => undefined }));
vi.mock('@aisha/aitg', () => ({
  createAitgRunner: () => ({}),
  withAitgGuard: async (_o: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../config.js', () => ({ config: { postgrestUrl: 'http://pg', postgrestServiceToken: 'tok', buildSha: 't' } }));

import { parseEvalSampleRate, shouldSampleEval } from '../lib/evalSampleRate.js';

const BACKEND = { model: 'judge', provider: 'vllm' as const };
const judge = (text: string) => ({ text, model: 'judge', usage: { inputTokens: 5, outputTokens: 3 } });

beforeEach(() => {
  mockRpcService.mockReset();
  mockUnifiedChat.mockReset();
});

describe('vzorkování (D8: neznámý přepínač = vypnuto)', () => {
  it.each([
    [undefined, 0], ['', 0], ['abc', 0], ['-0.1', 0], ['1.5', 0], ['0', 0], ['0.05', 0.05], ['1', 1],
  ])('CHAT_EVAL_SAMPLE_RATE=%s → %s', (raw, want) => {
    expect(parseEvalSampleRate(raw as string | undefined)).toBe(want);
  });

  it('0 nikdy, 1 vždy, jinak podle kostky', () => {
    expect(shouldSampleEval(0, () => 0)).toBe(false);
    expect(shouldSampleEval(1, () => 0.99)).toBe(true);
    expect(shouldSampleEval(0.05, () => 0.04)).toBe(true);
    expect(shouldSampleEval(0.05, () => 0.06)).toBe(false);
  });
});

describe('parseJudgeScores — jen úplné skóre 0–1 je měření', () => {
  it('úplné skóre projde, chybějící nebo mimo rozsah ne', async () => {
    const { parseJudgeScores } = await import('../lib/messageEvaluation.js');
    expect(parseJudgeScores('{"relevance":1,"groundedness":0.5,"safety":1,"coherence":0.5}')).toEqual({
      relevance: 1, groundedness: 0.5, safety: 1, coherence: 0.5,
    });
    expect(parseJudgeScores('{"relevance":1,"groundedness":0.5,"safety":1}')).toBeNull();
    expect(parseJudgeScores('{"relevance":2,"groundedness":0.5,"safety":1,"coherence":0.5}')).toBeNull();
    expect(parseJudgeScores('not json')).toBeNull();
  });
});

describe('evaluateChatMessage', () => {
  const zprava = { id: 'm1', content: 'Odpověď.', role: 'assistant', conversation_id: 'c1' };

  it('ohodnotí odpověď s otázkou a skóre uloží (kontrolní vzorek)', async () => {
    const { evaluateChatMessage } = await import('../lib/messageEvaluation.js');
    mockRpcService.mockImplementation(async (fn: string) =>
      fn === 'get_chat_message_by_id' ? zprava : fn === 'get_preceding_user_message' ? { content: 'Otázka?' } : null);
    mockUnifiedChat.mockResolvedValue(judge('{"relevance":1,"groundedness":0.5,"safety":1,"coherence":0.5}'));
    const out = await evaluateChatMessage('m1', BACKEND);
    expect(out).toMatchObject({ kind: 'ok', avgScore: 0.75, tokensUsed: 8 });
    const prompt = mockUnifiedChat.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Otázka?');
    expect(mockRpcService).toHaveBeenCalledWith('update_message_eval_score', expect.objectContaining({ p_message_id: 'm1', p_eval_score_avg: 0.75 }));
  });

  it('selhání uložení skóre se vrátí jako not_persisted — nespolkne se', async () => {
    const { evaluateChatMessage } = await import('../lib/messageEvaluation.js');
    mockRpcService.mockImplementation(async (fn: string) => {
      if (fn === 'get_chat_message_by_id') return zprava;
      if (fn === 'get_preceding_user_message') return null;
      throw new Error('db down');
    });
    mockUnifiedChat.mockResolvedValue(judge('{"relevance":1,"groundedness":1,"safety":1,"coherence":1}'));
    expect(await evaluateChatMessage('m1', BACKEND)).toEqual({ kind: 'not_persisted', error: 'db down' });
  });

  it('zpráva uživatele se nehodnotí a soudce se nevolá', async () => {
    const { evaluateChatMessage } = await import('../lib/messageEvaluation.js');
    mockRpcService.mockResolvedValue({ ...zprava, role: 'user' });
    expect(await evaluateChatMessage('m1', BACKEND)).toEqual({ kind: 'not_assistant' });
    expect(mockUnifiedChat).not.toHaveBeenCalled();
  });

  it('neexistující zpráva → not_found', async () => {
    const { evaluateChatMessage } = await import('../lib/messageEvaluation.js');
    mockRpcService.mockResolvedValue(null);
    expect(await evaluateChatMessage('m1', BACKEND)).toEqual({ kind: 'not_found' });
  });
});
