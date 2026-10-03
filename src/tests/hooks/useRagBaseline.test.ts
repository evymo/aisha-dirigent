/**
 * Unit tests for useRagBaseline (Step 0 of optimization plan 2026).
 *
 * Covers:
 *   - Hook calls fn_get_rag_baseline with correct args
 *   - Permission gate (admin-only) — disabled without view_admin_panel
 *   - Zod safeParse drops malformed rows (does not throw)
 *   - averageMetric helper edge cases (null, empty, all-null rows)
 *   - useRagRunDetail returns null when no row found
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRagBaseline, useRagRunDetail, averageMetric } from '@/hooks/useRagBaseline';
import type { RagBaseline } from '@/schemas/rpcResponseSchemas';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockRpc = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => ({ current: { id: 'u-1' } as { id: string } | null }));
const mockHasPermission = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: mockRpc },
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ user: mockUser.current }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));

const SAMPLE_BASELINE: RagBaseline = {
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

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.current = { id: 'u-1' };
  mockHasPermission.mockReturnValue(true);
});

describe('useRagBaseline', () => {
  it('passes profile, embedding model, and period_hours through to RPC', async () => {
    mockRpc.mockResolvedValue({ data: [SAMPLE_BASELINE], error: null });

    const { result } = renderHook(
      () => useRagBaseline('evidence_strict', 'text-embedding-3-small', 168),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith('fn_get_rag_baseline', {
      p_profile_slug: 'evidence_strict',
      p_embedding_model: 'text-embedding-3-small',
      p_period_hours: 168,
    });
    expect(result.current.data?.[0].faithfulness_avg).toBe(0.88);
  });

  it('disables query when user lacks view_admin_panel permission', async () => {
    mockHasPermission.mockReturnValue(false);
    mockRpc.mockResolvedValue({ data: [SAMPLE_BASELINE], error: null });

    const { result } = renderHook(
      () => useRagBaseline(null, null, 168),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('disables query when no user session', async () => {
    mockUser.current = null;
    mockRpc.mockResolvedValue({ data: [SAMPLE_BASELINE], error: null });

    const { result } = renderHook(
      () => useRagBaseline(null, null, 168),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('Zod safeParse filters out malformed rows (does NOT throw)', async () => {
    mockRpc.mockResolvedValue({
      data: [
        SAMPLE_BASELINE,
        // malformed: missing required fields
        { context_profile_slug: 'malformed', n_runs: 5 },
        // malformed: wrong type
        { ...SAMPLE_BASELINE, n_runs: 'not a number' },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useRagBaseline(null, null, 168),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].context_profile_slug).toBe('evidence_strict');
  });

  it('propagates RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const { result } = renderHook(
      () => useRagBaseline(null, null, 168),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('permission denied');
  });

  it('returns empty array when RPC returns null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(
      () => useRagBaseline(null, null, 168),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useRagRunDetail', () => {
  it('returns null when runId is undefined (no RPC fired)', async () => {
    mockRpc.mockResolvedValue({ data: [SAMPLE_BASELINE], error: null });
    const { result } = renderHook(
      () => useRagRunDetail(undefined),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns null when RPC returns empty array', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () => useRagRunDetail('00000000-0000-0000-0000-000000000001'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('parses first row through RagRunDetailSchema', async () => {
    const fixture = {
      run_id: '11111111-1111-1111-1111-111111111111',
      golden_id: '22222222-2222-2222-2222-222222222222',
      golden_slug: 'es-en-rule',
      question: 'Q',
      ground_truth_answer: 'GT',
      generated_answer: 'A',
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
      metadata: { language: 'en' },
      created_at: '2026-05-18T12:00:00Z',
    };
    mockRpc.mockResolvedValue({ data: [fixture], error: null });

    const { result } = renderHook(
      () => useRagRunDetail('11111111-1111-1111-1111-111111111111'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.golden_slug).toBe('es-en-rule');
    expect(result.current.data?.retrieved_chunk_ids).toHaveLength(1);
  });
});

describe('averageMetric helper', () => {
  it('returns null for undefined/empty input', () => {
    expect(averageMetric(undefined, 'faithfulness_avg')).toBeNull();
    expect(averageMetric([], 'faithfulness_avg')).toBeNull();
  });

  it('returns null when all rows have null metric', () => {
    const rows: RagBaseline[] = [
      { ...SAMPLE_BASELINE, faithfulness_avg: null, n_runs: 5 },
      { ...SAMPLE_BASELINE, faithfulness_avg: null, n_runs: 10 },
    ];
    expect(averageMetric(rows, 'faithfulness_avg')).toBeNull();
  });

  it('computes weighted average by n_runs', () => {
    const rows: RagBaseline[] = [
      { ...SAMPLE_BASELINE, faithfulness_avg: 0.8, n_runs: 10 },
      { ...SAMPLE_BASELINE, faithfulness_avg: 0.9, n_runs: 30 },
    ];
    // weighted = (0.8 * 10 + 0.9 * 30) / 40 = 35 / 40 = 0.875
    expect(averageMetric(rows, 'faithfulness_avg')).toBeCloseTo(0.875, 4);
  });

  it('skips rows with null value (does not divide by zero count)', () => {
    const rows: RagBaseline[] = [
      { ...SAMPLE_BASELINE, faithfulness_avg: 0.9, n_runs: 10 },
      { ...SAMPLE_BASELINE, faithfulness_avg: null, n_runs: 5 },
    ];
    expect(averageMetric(rows, 'faithfulness_avg')).toBeCloseTo(0.9, 4);
  });
});
