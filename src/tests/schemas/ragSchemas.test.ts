/**
 * Schema validation tests for RAG eval Zod schemas (Step 0 of optimization plan 2026).
 *
 * Pins the contract between fn_get_rag_baseline / fn_get_rag_run_detail RPCs
 * and the TS UI. If a migration changes a column type without updating the
 * schema (e.g. faithfulness_avg becomes text), this test catches the drift
 * in CI before it reaches users.
 */
import { describe, it, expect } from 'vitest';
import {
  RagBaselineSchema,
  RagRunDetailSchema,
} from '@/schemas/rpcResponseSchemas';

describe('RagBaselineSchema', () => {
  const VALID = {
    context_profile_slug: 'evidence_strict',
    embedding_model: 'text-embedding-3-small',
    llm_model: 'gpt-4o-mini',
    n_runs: 12,
    faithfulness_avg: 0.88,
    answer_relevancy_avg: 0.85,
    context_precision_avg: 0.92,
    context_recall_avg: 0.78,
    composite_avg: 0.86,
    faithfulness_p50: 0.9,
    faithfulness_p90: 0.95,
    period_start: '2026-05-11T00:00:00Z',
    period_end: '2026-05-18T00:00:00Z',
  };

  it('accepts a complete valid row', () => {
    const parsed = RagBaselineSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it('accepts null profile_slug (RPC GROUP BY emits NULL bucket)', () => {
    const parsed = RagBaselineSchema.safeParse({ ...VALID, context_profile_slug: null });
    expect(parsed.success).toBe(true);
  });

  it('accepts null metric values when no runs in period', () => {
    const parsed = RagBaselineSchema.safeParse({
      ...VALID,
      n_runs: 0,
      faithfulness_avg: null,
      answer_relevancy_avg: null,
      context_precision_avg: null,
      context_recall_avg: null,
      composite_avg: null,
      faithfulness_p50: null,
      faithfulness_p90: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects row with non-numeric n_runs', () => {
    const parsed = RagBaselineSchema.safeParse({ ...VALID, n_runs: 'lots' });
    expect(parsed.success).toBe(false);
  });

  it('rejects row missing embedding_model', () => {
    const { embedding_model, ...rest } = VALID;
    void embedding_model;
    const parsed = RagBaselineSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
  });

  it('rejects row with non-string period_start', () => {
    const parsed = RagBaselineSchema.safeParse({ ...VALID, period_start: 12345 });
    expect(parsed.success).toBe(false);
  });
});

describe('RagRunDetailSchema', () => {
  const VALID = {
    run_id: '11111111-1111-1111-1111-111111111111',
    golden_id: '22222222-2222-2222-2222-222222222222',
    golden_slug: 'es-en-rule',
    question: 'What is required for every SECURITY DEFINER function?',
    ground_truth_answer: 'SET search_path TO public is mandatory.',
    generated_answer: 'SET search_path TO public is mandatory.',
    context_profile_slug: 'evidence_strict',
    embedding_model: 'text-embedding-3-small',
    llm_model: 'gpt-4o-mini',
    retrieved_chunk_ids: ['33333333-3333-3333-3333-333333333333'],
    faithfulness_score: 0.95,
    answer_relevancy_score: 0.9,
    context_precision_score: 1.0,
    context_recall_score: 1.0,
    composite_score: 0.96,
    latency_ms: 1200,
    cost: 0.001234,
    metadata: { language: 'en', difficulty: 4 },
    created_at: '2026-05-18T12:00:00Z',
  };

  it('accepts a complete valid row', () => {
    const parsed = RagRunDetailSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
  });

  it('rejects row with non-uuid retrieved_chunk_ids', () => {
    const parsed = RagRunDetailSchema.safeParse({
      ...VALID,
      retrieved_chunk_ids: ['not-a-uuid', '33333333-3333-3333-3333-333333333333'],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts null generated_answer (failed eval)', () => {
    const parsed = RagRunDetailSchema.safeParse({ ...VALID, generated_answer: null });
    expect(parsed.success).toBe(true);
  });

  it('accepts null cost (when no usage tracking)', () => {
    const parsed = RagRunDetailSchema.safeParse({ ...VALID, cost: null });
    expect(parsed.success).toBe(true);
  });

  it('accepts arbitrary metadata shape (JSONB is intentionally loose)', () => {
    const parsed = RagRunDetailSchema.safeParse({
      ...VALID,
      metadata: { judge_reasoning: { faithfulness: '...' }, tokens: 500, nested: { a: { b: 1 } } },
    });
    expect(parsed.success).toBe(true);
  });
});
