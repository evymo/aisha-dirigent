import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/tests/utils/test-utils';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: vi.fn(),
    safeInfo: vi.fn(),
    safeWarn: vi.fn(),
  };
});

import { useQuestionnaireResponseDetail } from '@/hooks/useQuestionnaireResponseDetail';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockResponseDetail = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  user_id: '660e8400-e29b-41d4-a716-446655440002',
  questionnaire_id: '770e8400-e29b-41d4-a716-446655440003',
  responses: [
    { block_code: 'primary_concern', value: 'immunity' },
    { block_code: 'energy_level', value: 7 },
  ],
  score: 42,
  completed_at: '2026-02-20T10:00:00Z',
  created_at: '2026-02-20T09:55:00Z',
  questionnaire_version: 2,
  response_version: 1,
  questionnaire_name: 'Health Check',
  questionnaire_name_key: 'questionnaires.health_check',
  questionnaire_code: 'health_check',
  questionnaire_description: 'A brief health questionnaire',
  questionnaire_description_key: 'questionnaires.health_check_desc',
  questionnaire_questions: [{ id: 'q1', type: 'text' }],
  questionnaire_type: 'health',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useQuestionnaireResponseDetail', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it('should fetch response detail via audited RPC', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: mockResponseDetail, error: null });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail('550e8400-e29b-41d4-a716-446655440001'),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      'get_questionnaire_response_detail_audited',
      { p_response_id: '550e8400-e29b-41d4-a716-446655440001' },
    );

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.id).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.current.data?.score).toBe(42);
    expect(result.current.data?.questionnaire_name).toBe('Health Check');
    expect(result.current.data?.questionnaire_type).toBe('health');
  });

  it('should not fetch when responseId is null', () => {
    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail(null),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it('should not fetch when enabled is false', () => {
    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail('some-id', { enabled: false }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it('should handle RPC errors safely', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Access denied to response data', code: '42501' },
    });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail('some-id'),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Access denied to response data');
    // No sensitive data in error message
    expect(result.current.error?.message).not.toContain('@');
    expect(result.current.error?.message).not.toContain('email');
  });

  it('should handle empty response data', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail('some-id'),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Empty response data');
  });

  it('should validate response with Zod schema', async () => {
    const validResponse = { ...mockResponseDetail, score: null };
    hoisted.rpcMock.mockResolvedValue({ data: validResponse, error: null });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail('some-id'),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.score).toBeNull();
  });

  it('should handle responses as record format', async () => {
    const recordResponse = {
      ...mockResponseDetail,
      responses: { primary_concern: 'immunity', energy_level: 7 },
    };
    hoisted.rpcMock.mockResolvedValue({ data: recordResponse, error: null });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail('some-id'),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.responses).toEqual({
      primary_concern: 'immunity',
      energy_level: 7,
    });
  });

  it('should parse response with null optional fields', async () => {
    const minimalResponse = {
      ...mockResponseDetail,
      completed_at: null,
      questionnaire_version: null,
      response_version: null,
      questionnaire_description: null,
      questionnaire_description_key: null,
      questionnaire_questions: null,
      score: null,
    };
    hoisted.rpcMock.mockResolvedValue({ data: minimalResponse, error: null });

    const { result } = renderHookWithProviders(() =>
      useQuestionnaireResponseDetail('some-id'),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.completed_at).toBeNull();
    expect(result.current.data?.questionnaire_version).toBeNull();
  });
});
