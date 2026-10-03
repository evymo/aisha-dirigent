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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'cs' },
  }),
}));

import {
  useQuestionBlocks,
  useQuestionBlocksForContext,
} from '@/hooks/useQuestionBlocks';

// ============================================================================
// Mock data for Registration Wizard blocks
// ============================================================================

const mockRegistrationDateOfBirth = {
  id: '00000000-0000-4000-8000-000000000001',
  block_code: 'registration_date_of_birth',
  question_type: 'date',
  text_key: 'questionnaires.registration.date_of_birth.text',
  config: { minAge: 18, maxAge: 120 },
  is_required: true,
  is_active: true,
  display_order: 201,
  translated_text: 'Datum narození',
  translated_description: 'Pro účast ve studii musíte být starší 18 let',
  option_translations: {},
};

const mockRegistrationPhysicalState = {
  id: '00000000-0000-4000-8000-000000000002',
  block_code: 'registration_physical_state',
  question_type: 'scale',
  text_key: 'questionnaires.registration.physical_state.text',
  config: {
    min: 1,
    max: 10,
    step: 1,
    showValue: true,
    lowLabel_key: 'questionnaires.blocks.registration_physical_state.lowLabel',
    highLabel_key: 'questionnaires.blocks.registration_physical_state.highLabel',
  },
  is_required: true,
  is_active: true,
  display_order: 211,
  translated_text: 'Jak hodnotíte svůj fyzický stav?',
  translated_description: '1 = velmi špatný, 10 = výborný',
  option_translations: {},
};

const mockRegistrationHasPreexisting = {
  id: '00000000-0000-4000-8000-000000000003',
  block_code: 'registration_has_preexisting',
  question_type: 'boolean',
  text_key: 'questionnaires.registration.has_preexisting.text',
  config: {
    style: 'buttons',
    trueLabel_key: 'questionnaires.common.yes',
    falseLabel_key: 'questionnaires.common.no',
  },
  is_required: true,
  is_active: true,
  display_order: 221,
  translated_text: 'Máte nějaké chronické zdravotní problémy?',
  translated_description: null,
  option_translations: {},
};

const mockRegistrationGender = {
  id: '00000000-0000-4000-8000-000000000004',
  block_code: 'registration_gender',
  question_type: 'tags',
  text_key: 'questionnaires.registration.gender.text',
  config: {
    columns: 2,
    layout: 'grid',
    multiSelect: false,
    options: [
      { emoji: '👨', value: 'male' },
      { emoji: '👩', value: 'female' },
      { emoji: '⚧️', value: 'non_binary' },
      { emoji: '🤐', value: 'prefer_not_to_say' },
    ],
  },
  is_required: true,
  is_active: true,
  display_order: 241,
  translated_text: 'Pohlaví',
  translated_description: null,
  option_translations: {},
};

const mockRegistrationDifficulty = {
  id: '00000000-0000-4000-8000-000000000005',
  block_code: 'registration_difficulty',
  question_type: 'scale',
  text_key: 'questionnaires.registration.difficulty.text',
  config: {
    min: 1,
    max: 10,
    step: 1,
    showValue: true,
    lowLabel_key: 'questionnaires.blocks.registration_difficulty.lowLabel',
    highLabel_key: 'questionnaires.blocks.registration_difficulty.highLabel',
  },
  is_required: false,
  is_active: true,
  display_order: 261,
  translated_text: 'Jak obtížné bylo vyplnit tento dotazník?',
  translated_description: '1 = velmi obtížné, 10 = velmi snadné',
  option_translations: {},
};

describe('Registration Wizard Question Blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useQuestionBlocks with registration codes', () => {
    it('should fetch registration_date_of_birth block', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationDateOfBirth],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_date_of_birth'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].block_code).toBe('registration_date_of_birth');
      expect(result.current.data?.[0].question_type).toBe('date');
      expect(result.current.data?.[0].is_required).toBe(true);
    });

    it('should fetch registration_physical_state scale block', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationPhysicalState],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_physical_state'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.[0].question_type).toBe('scale');
      expect(result.current.data?.[0].config).toMatchObject({
        min: 1,
        max: 10,
      });
    });

    it('should fetch registration_has_preexisting boolean block', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationHasPreexisting],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_has_preexisting'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.[0].question_type).toBe('boolean');
      expect(result.current.data?.[0].rawConfig).toMatchObject({
        style: 'buttons',
      });
    });

    it('should fetch registration_gender tags block with options', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationGender],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_gender'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.[0].question_type).toBe('tags');
      const config = result.current.data?.[0].rawConfig as Record<string, unknown>;
      expect(config.options).toHaveLength(4);
    });

    it('should fetch multiple registration blocks sorted by display_order', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          mockRegistrationDifficulty,  // order 261
          mockRegistrationDateOfBirth, // order 201
          mockRegistrationPhysicalState, // order 211
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_date_of_birth', 'registration_physical_state', 'registration_difficulty'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toHaveLength(3);
      // Should be sorted by display_order
      expect(result.current.data?.[0].block_code).toBe('registration_date_of_birth');
      expect(result.current.data?.[1].block_code).toBe('registration_physical_state');
      expect(result.current.data?.[2].block_code).toBe('registration_difficulty');
    });
  });

  describe('useQuestionBlocksForContext - registration contexts', () => {
    it('should return registration_basic_info blocks', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationDateOfBirth],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('registration_basic_info')
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'get_question_blocks_by_context_type',
        {
          p_context_type: 'registration_basic_info',
          p_locale: 'cs',
        }
      );
    });

    it('should return registration_current_state blocks', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationPhysicalState],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('registration_current_state')
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'get_question_blocks_by_context_type',
        {
          p_context_type: 'registration_current_state',
          p_locale: 'cs',
        }
      );
    });

    it('should return registration_health_history blocks', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationHasPreexisting],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('registration_health_history')
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'get_question_blocks_by_context_type',
        {
          p_context_type: 'registration_health_history',
          p_locale: 'cs',
        }
      );
    });

    it('should return registration_lifestyle blocks', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationGender],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('registration_lifestyle')
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'get_question_blocks_by_context_type',
        {
          p_context_type: 'registration_lifestyle',
          p_locale: 'cs',
        }
      );
    });

    it('should return registration_feedback blocks', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationDifficulty],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('registration_feedback')
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'get_question_blocks_by_context_type',
        {
          p_context_type: 'registration_feedback',
          p_locale: 'cs',
        }
      );
    });

    it('should return intake blocks', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('intake')
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'get_question_blocks_by_context_type',
        {
          p_context_type: 'intake',
          p_locale: 'cs',
        }
      );
    });
  });

  describe('Error handling', () => {
    it('should handle RPC errors gracefully', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_date_of_birth'])
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });

    it('should return empty array for unknown context', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('unknown_registration_step')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'get_question_blocks_by_context_type',
        {
          p_context_type: 'unknown_registration_step',
          p_locale: 'cs',
        }
      );
      expect(result.current.data).toEqual([]);
    });
  });

  describe('Block type validation', () => {
    it('should validate scale block config', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationPhysicalState],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_physical_state'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const block = result.current.data?.[0];
      expect(block?.config).toBeDefined();
      // Scale config should have min, max, step
      expect(block?.config).toMatchObject({
        min: 1,
        max: 10,
        step: 1,
      });
    });

    it('should provide translated text and description', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockRegistrationDateOfBirth],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['registration_date_of_birth'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const block = result.current.data?.[0];
      expect(block?.translatedText).toBe('Datum narození');
      expect(block?.translatedDescription).toBe('Pro účast ve studii musíte být starší 18 let');
    });
  });
});
