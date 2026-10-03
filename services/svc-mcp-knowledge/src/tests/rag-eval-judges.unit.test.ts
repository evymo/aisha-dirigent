/**
 * Unit tests for rag-eval-judges (Step 0 of optimization plan 2026).
 *
 * Scope: deterministic scoring contracts. The LLM call is mocked — these
 * tests verify the GLUE around the LLM (parsing, clamping, set-based
 * short-circuit, parallel branching) — not the LLM's intelligence.
 *
 * The judge prompts themselves are reviewed manually + locked at v1 in the
 * file; they're a kind of frozen spec. A separate "judge calibration" test
 * (deferred — needs DB + real LLM) compares LLM scores against human-labeled
 * fixtures to catch judge-prompt drift.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCompletion = vi.hoisted(() => vi.fn());

vi.mock('../lib/llm-completion.js', () => ({
  chatCompletion: mockCompletion,
  chatCompletionWithRetry: mockCompletion,
  LlmCompletionError: class extends Error {
    statusCode: number;
    constructor(status: number, message: string) {
      super(message);
      this.statusCode = status;
    }
  },
}));

import { scoreEvalRun, slugMatches, type RetrievedChunk } from '../lib/rag-eval-judges.js';

describe('slugMatches — item-level + chunk-level set-based matching', () => {
  // Retrieved slugs are <source_slug>:<chunk_index> (computed in mcp_search_knowledge_v3).
  it('chunk-level exact match', () => {
    expect(slugMatches('frontend-development:2', 'frontend-development:2')).toBe(true);
    expect(slugMatches('frontend-development:2', 'frontend-development:3')).toBe(false);
  });
  it('item-level: a bare source_slug matches ANY chunk of that item', () => {
    expect(slugMatches('frontend-development:0', 'frontend-development')).toBe(true);
    expect(slugMatches('frontend-development:7', 'frontend-development')).toBe(true);
  });
  it('item-level does NOT match a different item or a mere prefix', () => {
    expect(slugMatches('frontend-development:0', 'architecture')).toBe(false);
    expect(slugMatches('frontend-development:0', 'frontend')).toBe(false);
  });
  it('uuid-sourced slugs (no source_slug) split on the last colon', () => {
    expect(slugMatches('a1000001-0000-4000-8000-000000000001:0', 'a1000001-0000-4000-8000-000000000001')).toBe(true);
  });
  it('bare-source exact match when retrieved has no chunk index', () => {
    expect(slugMatches('aisha', 'aisha')).toBe(true);
  });
});

function judgeResponse(score: number, reasoning = 'r'): { text: string; usage: { total_tokens: number }; latency_ms: number; model: string; finish_reason: string } {
  return {
    text: JSON.stringify({ score, reasoning }),
    usage: { total_tokens: 50, prompt_tokens: 40, completion_tokens: 10 },
    latency_ms: 100,
    model: 'judge-model',
    finish_reason: 'stop',
  } as never;
}

describe('rag-eval-judges — scoreEvalRun()', () => {
  beforeEach(() => {
    mockCompletion.mockReset();
  });

  it('calls 4 LLM judges when expected_chunk_slugs is empty (no set-based path)', async () => {
    mockCompletion
      .mockResolvedValueOnce(judgeResponse(0.92))
      .mockResolvedValueOnce(judgeResponse(0.84))
      .mockResolvedValueOnce(judgeResponse(0.75))
      .mockResolvedValueOnce(judgeResponse(0.66));

    const result = await scoreEvalRun({
      question: 'Q',
      generated_answer: 'A',
      ground_truth_answer: 'GT',
      retrieved_chunks: [{ id: 'c1', text: 'ctx', slug: null }],
      expected_chunk_slugs: [],
      judge_model: 'judge',
    });

    expect(mockCompletion).toHaveBeenCalledTimes(4);
    expect(result.faithfulness).toBe(0.92);
    expect(result.answer_relevancy).toBe(0.84);
    expect(result.context_precision).toBe(0.75);
    expect(result.context_recall).toBe(0.66);
    expect(result.set_based_precision).toBe(false);
    expect(result.set_based_recall).toBe(false);
    expect(result.judge_tokens_total).toBe(200); // 4 × 50
  });

  it('uses set-based precision+recall when expected_chunk_slugs provided (only 2 LLM calls)', async () => {
    mockCompletion
      .mockResolvedValueOnce(judgeResponse(0.9)) // faithfulness
      .mockResolvedValueOnce(judgeResponse(0.8)); // answer_relevancy

    const chunks: RetrievedChunk[] = [
      { id: 'c1', text: 't1', slug: 'expected-a' },
      { id: 'c2', text: 't2', slug: 'expected-b' },
      { id: 'c3', text: 't3', slug: 'not-expected' },
    ];

    const result = await scoreEvalRun({
      question: 'Q',
      generated_answer: 'A',
      ground_truth_answer: 'GT',
      retrieved_chunks: chunks,
      expected_chunk_slugs: ['expected-a', 'expected-b', 'expected-c'],
      judge_model: 'judge',
    });

    expect(mockCompletion).toHaveBeenCalledTimes(2);
    expect(result.set_based_precision).toBe(true);
    expect(result.set_based_recall).toBe(true);
    // Precision = 2 retrieved ∩ expected / 3 retrieved = 0.667
    expect(result.context_precision).toBeCloseTo(0.667, 2);
    // Recall = 2 expected ∩ retrieved / 3 expected = 0.667
    expect(result.context_recall).toBeCloseTo(0.667, 2);
  });

  it('clamps scores outside [0,1] returned by judge', async () => {
    mockCompletion
      .mockResolvedValueOnce(judgeResponse(1.5))
      .mockResolvedValueOnce(judgeResponse(-0.1))
      .mockResolvedValueOnce(judgeResponse(0.5))
      .mockResolvedValueOnce(judgeResponse(0.5));

    const result = await scoreEvalRun({
      question: 'Q', generated_answer: 'A', ground_truth_answer: 'GT',
      retrieved_chunks: [{ id: 'c1', text: 't', slug: null }],
      expected_chunk_slugs: [],
      judge_model: 'judge',
    });
    expect(result.faithfulness).toBe(1);
    expect(result.answer_relevancy).toBe(0);
  });

  it('handles judge returning markdown-wrapped JSON (```json fence)', async () => {
    const wrapped = {
      text: '```json\n{"score": 0.77, "reasoning": "ok"}\n```',
      usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10 },
      latency_ms: 50,
      model: 'judge',
      finish_reason: 'stop',
    };
    mockCompletion
      .mockResolvedValueOnce(wrapped)
      .mockResolvedValueOnce(wrapped)
      .mockResolvedValueOnce(wrapped)
      .mockResolvedValueOnce(wrapped);

    const result = await scoreEvalRun({
      question: 'Q', generated_answer: 'A', ground_truth_answer: 'GT',
      retrieved_chunks: [{ id: 'c1', text: 't', slug: null }],
      expected_chunk_slugs: [],
      judge_model: 'judge',
    });
    expect(result.faithfulness).toBe(0.77);
  });

  it('throws when judge returns non-JSON garbage', async () => {
    mockCompletion.mockResolvedValueOnce({
      text: 'this is not json at all',
      usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10 },
      latency_ms: 50,
      model: 'judge',
      finish_reason: 'stop',
    });
    await expect(
      scoreEvalRun({
        question: 'Q', generated_answer: 'A', ground_truth_answer: 'GT',
        retrieved_chunks: [{ id: 'c1', text: 't', slug: null }],
        expected_chunk_slugs: [],
        judge_model: 'judge',
      }),
    ).rejects.toThrow(/non-JSON/);
  });

  it('throws when judge JSON lacks score field', async () => {
    mockCompletion.mockResolvedValueOnce({
      text: '{"reasoning": "but no score"}',
      usage: { total_tokens: 30, prompt_tokens: 20, completion_tokens: 10 },
      latency_ms: 50,
      model: 'judge',
      finish_reason: 'stop',
    });
    await expect(
      scoreEvalRun({
        question: 'Q', generated_answer: 'A', ground_truth_answer: 'GT',
        retrieved_chunks: [{ id: 'c1', text: 't', slug: null }],
        expected_chunk_slugs: [],
        judge_model: 'judge',
      }),
    ).rejects.toThrow(/missing numeric "score"/);
  });

  it('records token + latency totals across all judge calls', async () => {
    mockCompletion
      .mockResolvedValueOnce({ text: '{"score":0.9}', usage: { total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 }, latency_ms: 200, model: 'm', finish_reason: 'stop' })
      .mockResolvedValueOnce({ text: '{"score":0.8}', usage: { total_tokens: 90, prompt_tokens: 80, completion_tokens: 10 }, latency_ms: 180, model: 'm', finish_reason: 'stop' })
      .mockResolvedValueOnce({ text: '{"score":0.7}', usage: { total_tokens: 110, prompt_tokens: 100, completion_tokens: 10 }, latency_ms: 220, model: 'm', finish_reason: 'stop' })
      .mockResolvedValueOnce({ text: '{"score":0.6}', usage: { total_tokens: 80, prompt_tokens: 70, completion_tokens: 10 }, latency_ms: 160, model: 'm', finish_reason: 'stop' });

    const result = await scoreEvalRun({
      question: 'Q', generated_answer: 'A', ground_truth_answer: 'GT',
      retrieved_chunks: [{ id: 'c1', text: 't', slug: null }],
      expected_chunk_slugs: [],
      judge_model: 'judge',
    });
    expect(result.judge_tokens_total).toBe(380);
    expect(result.judge_latency_ms_total).toBe(760);
  });

  it('set-based recall returns 0 when no chunks retrieved (and expected non-empty)', async () => {
    // No slugs retrieved → useSetBased is false → all 4 LLM judges run.
    mockCompletion
      .mockResolvedValueOnce(judgeResponse(0.0))
      .mockResolvedValueOnce(judgeResponse(0.0))
      .mockResolvedValueOnce(judgeResponse(0.0))
      .mockResolvedValueOnce(judgeResponse(0.0));

    const result = await scoreEvalRun({
      question: 'Q', generated_answer: 'A', ground_truth_answer: 'GT',
      retrieved_chunks: [],
      expected_chunk_slugs: ['expected-a', 'expected-b'],
      judge_model: 'judge',
    });
    // No slugs retrieved → LLM fallback fires (not set-based)
    expect(result.set_based_precision).toBe(false);
    expect(result.set_based_recall).toBe(false);
    expect(mockCompletion).toHaveBeenCalledTimes(4);
  });

  it('set-based precision returns 0 when expected and retrieved have no overlap', async () => {
    mockCompletion
      .mockResolvedValueOnce(judgeResponse(0.5))
      .mockResolvedValueOnce(judgeResponse(0.5));

    const result = await scoreEvalRun({
      question: 'Q', generated_answer: 'A', ground_truth_answer: 'GT',
      retrieved_chunks: [
        { id: 'c1', text: 't', slug: 'unrelated-1' },
        { id: 'c2', text: 't', slug: 'unrelated-2' },
      ],
      expected_chunk_slugs: ['expected-a', 'expected-b'],
      judge_model: 'judge',
    });
    expect(result.set_based_precision).toBe(true);
    expect(result.context_precision).toBe(0);
    expect(result.context_recall).toBe(0);
  });
});
