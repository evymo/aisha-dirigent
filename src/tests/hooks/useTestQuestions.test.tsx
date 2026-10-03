import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/utils/test-utils';

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en' },
    }),
  };
});

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

import {
  useAllTestQuestions,
  useCreateTestQuestion,
  useDeleteTestQuestion,
  useTestQuestions,
  useTestResults,
  useUpdateTestQuestion,
  useValidateTestAnswers,
} from '@/hooks/useTestQuestions';
import { mockAdminPermissions } from '@/tests/utils/permissions';

describe('useTestQuestions', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    mockAdminPermissions();
  });

  it('načte public otázky přes RPC', async () => {
    hoisted.rpcMock.mockReturnValue(
      Promise.resolve({
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            test_type: 'qualification',
            question_order: 1,
            question_key: 'test.q1',
            option_a_key: 'test.q1.a',
            option_b_key: 'test.q1.b',
            option_c_key: 'test.q1.c',
            is_active: true,
            created_at: '2025-01-01',
            updated_at: '2025-01-01',
          },
        ],
        error: null,
      })
    );

    const { result } = renderHookWithProviders(() => useTestQuestions('qualification'));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_test_questions_public_localized', {
      p_locale: 'en',
      p_test_type: 'qualification',
    });
    expect(result.current.data?.[0]?.id).toBe('550e8400-e29b-41d4-a716-446655440001');
  });

  it('propaguje chybu z RPC', async () => {
    hoisted.rpcMock.mockReturnValue(Promise.resolve({ data: null, error: new Error('fail') }));

    const { result } = renderHookWithProviders(() => useTestQuestions('certification'));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('validuje odpovědi přes RPC', async () => {
    hoisted.rpcMock.mockReturnValue(
      Promise.resolve({
        data: { total_questions: 10, correct_count: 9, score: 90, passed: true },
        error: null,
      })
    );

    const { result } = renderHookWithProviders(() => useValidateTestAnswers());

    const response = await result.current.mutateAsync({
      testType: 'qualification',
      answers: { q1: 'a' },
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('validate_test_answers', {
      p_test_type: 'qualification',
      p_answers: { q1: 'a' },
    });
    expect(response.passed).toBe(true);
    expect(response.score).toBe(90);
  });
});

describe('admin test questions', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it('načte všechny otázky přes RPC get_test_questions_admin', async () => {
    hoisted.rpcMock.mockReturnValue(
      Promise.resolve({
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            test_type: 'qualification',
            question_order: 1,
            question_key: 'test.q1',
            option_a_key: 'test.q1.a',
            option_b_key: 'test.q1.b',
            option_c_key: 'test.q1.c',
            correct_answer: 'a',
            is_active: true,
            created_at: '2025-01-01',
            updated_at: '2025-01-01',
          },
        ],
        error: null,
      })
    );

    const { result } = renderHookWithProviders(() => useAllTestQuestions('qualification'));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_test_questions_admin_localized', {
      p_locale: 'en',
      p_test_type: 'qualification',
    });
    expect(result.current.data?.[0]?.id).toBe('550e8400-e29b-41d4-a716-446655440001');
  });

  it('create/update/delete invalidují relevantní queries', async () => {
    const mockCreatedQuestion = {
      id: 'q1',
      test_type: 'qualification',
      question_order: 1,
      question_key: 'test.q1',
      option_a_key: 'test.q1.a',
      option_b_key: 'test.q1.b',
      option_c_key: 'test.q1.c',
      correct_answer: 'a',
      is_active: true,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };

    const mockUpdatedQuestion = {
      ...mockCreatedQuestion,
      question_order: 2,
      updated_at: '2025-01-02',
    };

    // Setup mocks for all RPC calls
    hoisted.rpcMock
      .mockReturnValueOnce(Promise.resolve({ data: mockCreatedQuestion, error: null }))
      .mockReturnValueOnce(Promise.resolve({ data: mockUpdatedQuestion, error: null }))
      .mockReturnValueOnce(Promise.resolve({ data: null, error: null }));

    const question = {
      test_type: 'qualification' as const,
      question_order: 1,
      question_key: 'test.q1',
      option_a_key: 'test.q1.a',
      option_b_key: 'test.q1.b',
      option_c_key: 'test.q1.c',
      correct_answer: 'a' as const,
      is_active: true,
    };

    const { result: createResult, queryClient } = renderHookWithProviders(() => useCreateTestQuestion());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await createResult.current.mutateAsync(question);

    expect(hoisted.rpcMock).toHaveBeenCalledWith('create_test_question_admin', expect.objectContaining({
      p_test_type: 'qualification',
      p_question_order: 1,
      p_correct_answer: 'a',
      p_is_active: true,
    }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['test-questions', 'qualification'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['all-test-questions', 'qualification'] });

    const { result: updateResult } = renderHookWithProviders(() => useUpdateTestQuestion(), { queryClient });
    await updateResult.current.mutateAsync({ id: 'q1', question_order: 2 });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('update_test_question_admin', expect.objectContaining({
      p_question_id: 'q1',
      p_question_order: 2,
    }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['test-questions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['all-test-questions'] });

    const { result: deleteResult } = renderHookWithProviders(() => useDeleteTestQuestion(), { queryClient });
    await deleteResult.current.mutateAsync('q1');

    expect(hoisted.rpcMock).toHaveBeenCalledWith('delete_test_question_admin', { p_question_id: 'q1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['test-questions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['all-test-questions'] });
  });

  it('admin useTestResults má větev qualification vs certification', async () => {
    hoisted.rpcMock
      .mockReturnValueOnce(Promise.resolve({ data: [{ id: 'm1', user_id: 'u1' }], error: null }))
      .mockReturnValueOnce(Promise.resolve({ data: [{ id: 'c1', partner_id: 'p1' }], error: null }));

    const { result: qualificationResult } = renderHookWithProviders(() => useTestResults('qualification'));
    await waitFor(() => expect(qualificationResult.current.isSuccess).toBe(true));
    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_qualification_test_results_admin');
    expect((qualificationResult.current.data as unknown as Array<{ id: string }>)?.[0]?.id).toBe('m1');

    const { result: certificationResult } = renderHookWithProviders(() => useTestResults('certification'));
    await waitFor(() => expect(certificationResult.current.isSuccess).toBe(true));
    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_certification_test_results_admin');
    expect((certificationResult.current.data as unknown as Array<{ id: string }>)?.[0]?.id).toBe('c1');
  });
});
