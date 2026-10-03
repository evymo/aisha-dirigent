import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
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

import {
  useSubmitBlockResponse,
  useSubmitBlockResponses,
  type SubmitBlockResponseInput,
  type SubmitBlockResponseResult,
} from '@/hooks/useSubmitBlockResponse';

// Mock response from RPC
const mockSubmitResult: SubmitBlockResponseResult = {
  response_id: '550e8400-e29b-41d4-a716-446655440010',
  block_code: 'primary_concern',
  question_type: 'tags',
  context_type: 'onboarding',
  context_id: null,
  response: {
    block_code: 'primary_concern',
    values: ['immunity'],
  },
  validated: true,
};

const validTagInput: SubmitBlockResponseInput = {
  contextType: 'onboarding',
  blockCode: 'primary_concern',
  questionType: 'tags',
  response: {
    block_code: 'primary_concern',
    values: ['immunity', 'energy'],
  },
};

const validScaleInput: SubmitBlockResponseInput = {
  contextType: 'check_in',
  blockCode: 'pain_level',
  questionType: 'scale',
  response: {
    block_code: 'pain_level',
    value: 5,
  },
};

const validFeelingPresetInput: SubmitBlockResponseInput = {
  contextType: 'onboarding',
  blockCode: 'overall_feeling',
  questionType: 'feeling_preset',
  response: {
    block_code: 'overall_feeling',
    preset_id: 'great',
    computed_values: { energy: 8, mood: 8 },
  },
};

const validBooleanInput: SubmitBlockResponseInput = {
  contextType: 'questionnaire',
  blockCode: 'has_allergies',
  questionType: 'boolean',
  response: {
    block_code: 'has_allergies',
    value: true,
  },
};

describe('useSubmitBlockResponse hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
  });

  describe('useSubmitBlockResponse', () => {
    it('submits tag response via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: mockSubmitResult,
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() =>
        useSubmitBlockResponse()
      );
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync(validTagInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('submit_block_response_audited', {
        p_context_type: 'onboarding',
        p_block_code: 'primary_concern',
        p_question_type: 'tags',
        p_response: {
          block_code: 'primary_concern',
          values: ['immunity', 'energy'],
        },
        p_context_id: undefined,
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['block-responses', 'onboarding', undefined],
      });
    });

    it('submits scale response via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: {
          ...mockSubmitResult,
          block_code: 'pain_level',
          question_type: 'scale',
          context_type: 'check_in',
        },
        error: null,
      });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      await act(async () => {
        await result.current.mutateAsync(validScaleInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('submit_block_response_audited', {
        p_context_type: 'check_in',
        p_block_code: 'pain_level',
        p_question_type: 'scale',
        p_response: {
          block_code: 'pain_level',
          value: 5,
        },
        p_context_id: undefined,
      });
    });

    it('submits feeling preset response via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: {
          ...mockSubmitResult,
          block_code: 'overall_feeling',
          question_type: 'feeling_preset',
        },
        error: null,
      });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      await act(async () => {
        await result.current.mutateAsync(validFeelingPresetInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('submit_block_response_audited', {
        p_context_type: 'onboarding',
        p_block_code: 'overall_feeling',
        p_question_type: 'feeling_preset',
        p_response: expect.objectContaining({
          preset_id: 'great',
          computed_values: { energy: 8, mood: 8 },
        }),
        p_context_id: undefined,
      });
    });

    it('submits boolean response via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: {
          ...mockSubmitResult,
          block_code: 'has_allergies',
          question_type: 'boolean',
          context_type: 'questionnaire',
        },
        error: null,
      });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      await act(async () => {
        await result.current.mutateAsync(validBooleanInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('submit_block_response_audited', {
        p_context_type: 'questionnaire',
        p_block_code: 'has_allergies',
        p_question_type: 'boolean',
        p_response: {
          block_code: 'has_allergies',
          value: true,
        },
        p_context_id: undefined,
      });
    });

    it('includes context_id when provided', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: {
          ...mockSubmitResult,
          context_id: 'session-123',
        },
        error: null,
      });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      const inputWithContext: SubmitBlockResponseInput = {
        ...validTagInput,
        contextId: 'session-123',
      };

      await act(async () => {
        await result.current.mutateAsync(inputWithContext);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('submit_block_response_audited', {
        p_context_type: 'onboarding',
        p_block_code: 'primary_concern',
        p_question_type: 'tags',
        p_response: expect.any(Object),
        p_context_id: 'session-123',
      });
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Validation failed on server' },
      });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      let thrownError: Error | null = null;
      try {
        await act(async () => {
          await result.current.mutateAsync(validTagInput);
        });
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).not.toBeNull();
    });

    it('validates response before RPC call', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: mockSubmitResult,
        error: null,
      });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      // Invalid tag response (missing required fields)
      const invalidInput: SubmitBlockResponseInput = {
        contextType: 'onboarding',
        blockCode: 'test',
        questionType: 'tags',
        response: { invalid: 'data' } as unknown as SubmitBlockResponseInput['response'],
      };

      let thrownError: Error | null = null;
      try {
        await act(async () => {
          await result.current.mutateAsync(invalidInput);
        });
      } catch (e) {
        thrownError = e as Error;
      }

      // Should throw validation error before RPC
      expect(thrownError).not.toBeNull();
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('returns result from RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: mockSubmitResult,
        error: null,
      });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      let submitResult: SubmitBlockResponseResult | null = null;
      await act(async () => {
        submitResult = await result.current.mutateAsync(validTagInput);
      });

      const finalResult = submitResult as SubmitBlockResponseResult | null;
      expect(finalResult?.response_id).toBe('550e8400-e29b-41d4-a716-446655440010');
      expect(finalResult?.validated).toBe(true);
    });
  });

  describe('useSubmitBlockResponses (batch)', () => {
    it('submits multiple responses sequentially', async () => {
      hoisted.rpcMock
        .mockResolvedValueOnce({ data: { ...mockSubmitResult, block_code: 'primary_concern' }, error: null })
        .mockResolvedValueOnce({ data: { ...mockSubmitResult, block_code: 'overall_feeling' }, error: null })
        .mockResolvedValueOnce({ data: { ...mockSubmitResult, block_code: 'pain_level' }, error: null });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponses());

      const inputs: SubmitBlockResponseInput[] = [
        validTagInput,
        validFeelingPresetInput,
        validScaleInput,
      ];

      let results: SubmitBlockResponseResult[] = [];
      await act(async () => {
        results = await result.current.mutateAsync(inputs);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
      expect(results[0].block_code).toBe('primary_concern');
      expect(results[1].block_code).toBe('overall_feeling');
      expect(results[2].block_code).toBe('pain_level');
    });

    it('stops on first error', async () => {
      hoisted.rpcMock
        .mockResolvedValueOnce({ data: mockSubmitResult, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'Second failed' } });

      const { result } = renderHookWithProviders(() => useSubmitBlockResponses());

      const inputs: SubmitBlockResponseInput[] = [
        validTagInput,
        validFeelingPresetInput,
        validScaleInput,
      ];

      let thrownError: Error | null = null;
      try {
        await act(async () => {
          await result.current.mutateAsync(inputs);
        });
      } catch (e) {
        thrownError = e as Error;
      }

      // Should fail on second and not continue to third
      expect(thrownError).not.toBeNull();
      expect(hoisted.rpcMock).toHaveBeenCalledTimes(2);
    });

    it('returns empty array for empty inputs', async () => {
      const { result } = renderHookWithProviders(() => useSubmitBlockResponses());

      let results: SubmitBlockResponseResult[] = [];
      await act(async () => {
        results = await result.current.mutateAsync([]);
      });

      expect(results).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('Response validation by question type', () => {
    beforeEach(() => {
      hoisted.rpcMock.mockResolvedValue({
        data: mockSubmitResult,
        error: null,
      });
    });

    it('validates text response', async () => {
      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      const textInput: SubmitBlockResponseInput = {
        contextType: 'questionnaire',
        blockCode: 'notes',
        questionType: 'text',
        response: {
          block_code: 'notes',
          value: 'Some text notes',
        },
      };

      await act(async () => {
        await result.current.mutateAsync(textInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalled();
    });

    it('validates number response', async () => {
      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      const numberInput: SubmitBlockResponseInput = {
        contextType: 'questionnaire',
        blockCode: 'age',
        questionType: 'number',
        response: {
          block_code: 'age',
          value: 35,
        },
      };

      await act(async () => {
        await result.current.mutateAsync(numberInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalled();
    });

    it('validates select response', async () => {
      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      const selectInput: SubmitBlockResponseInput = {
        contextType: 'questionnaire',
        blockCode: 'gender',
        questionType: 'select',
        response: {
          block_code: 'gender',
          value: 'male',
        },
      };

      await act(async () => {
        await result.current.mutateAsync(selectInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalled();
    });

    it('validates checkbox response', async () => {
      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      const checkboxInput: SubmitBlockResponseInput = {
        contextType: 'questionnaire',
        blockCode: 'symptoms',
        questionType: 'checkbox',
        response: {
          block_code: 'symptoms',
          values: ['headache', 'fatigue', 'nausea'],
        },
      };

      await act(async () => {
        await result.current.mutateAsync(checkboxInput);
      });

      expect(hoisted.rpcMock).toHaveBeenCalled();
    });

    it('rejects invalid scale value type', async () => {
      const { result } = renderHookWithProviders(() => useSubmitBlockResponse());

      const invalidScaleInput: SubmitBlockResponseInput = {
        contextType: 'check_in',
        blockCode: 'pain_level',
        questionType: 'scale',
        response: {
          block_code: 'pain_level',
          value: 'not a number' as unknown as number, // Invalid
        },
      };

      let thrownError: Error | null = null;
      try {
        await act(async () => {
          await result.current.mutateAsync(invalidScaleInput);
        });
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });
});
