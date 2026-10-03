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
  useQuestionBlock,
  useQuestionBlocksForContext,
  type ValidatedQuestionBlock,
} from '@/hooks/useQuestionBlocks';

// Mock data matching RPC response schema
const mockBlockData = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  block_code: 'primary_concern',
  question_type: 'tags',
  text_key: 'onboarding.primary_concern',
  config: {
    multiSelect: false,
    minSelected: 1,
    options: [
      { value: 'immunity', emoji: '🛡️', label_key: 'tags.immunity' },
      { value: 'energy', emoji: '⚡', label_key: 'tags.energy' },
      { value: 'aging', emoji: '🧬', label_key: 'tags.aging' },
    ],
    layout: 'grid',
    columns: 2,
  },
  is_required: true,
  is_active: true,
  display_order: 1,
  translated_text: 'Co vás nejvíce trápí?',
  translated_description: 'Vyberte jednu hlavní oblast',
  option_translations: {
    'tags.immunity': 'Imunita (DB)',
    'tags.energy': 'Energie (DB)',
    'tags.aging': 'Stárnutí (DB)',
  },
};

const mockFeelingPresetBlock = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  block_code: 'overall_feeling',
  question_type: 'feeling_preset',
  text_key: 'onboarding.overall_feeling',
  config: {
    presets: [
      { id: 'great', emoji: '😊', label_key: 'presets.great', values: { energy: 8, mood: 8 } },
      { id: 'okay', emoji: '🙂', label_key: 'presets.okay', values: { energy: 6, mood: 6 } },
      { id: 'meh', emoji: '😐', label_key: 'presets.meh', values: { energy: 4, mood: 4 } },
    ],
    showLabels: true,
    showDescriptions: true,
    size: 'lg',
  },
  is_required: true,
  is_active: true,
  display_order: 2,
  translated_text: 'Jak se celkově cítíte?',
  translated_description: null,
  option_translations: {
    'presets.great': 'Skvěle (DB)',
    'presets.okay': 'Dobře (DB)',
    'presets.meh': 'Tak tak (DB)',
  },
};

const mockScaleBlock = {
  id: '550e8400-e29b-41d4-a716-446655440003',
  block_code: 'energy_perception',
  question_type: 'scale',
  text_key: 'onboarding.energy_perception',
  config: {
    min: 0,
    max: 10,
    step: 1,
    showValue: true,
    lowLabel_key: 'questionnaires.blocks.energy_perception.lowLabel',
    highLabel_key: 'questionnaires.blocks.energy_perception.highLabel',
  },
  is_required: true,
  is_active: true,
  display_order: 3,
  translated_text: 'Jak hodnotíte svou energii?',
  translated_description: 'Na škále 0-10',
  option_translations: {},
};

describe('useQuestionBlocks hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
  });

  describe('useQuestionBlocks', () => {
    it('fetches question blocks via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData, mockFeelingPresetBlock],
        error: null,
      });

      const codes = ['primary_concern', 'overall_feeling'];
      const { result } = renderHookWithProviders(() => useQuestionBlocks(codes));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_question_blocks_for_context', {
        p_block_codes: ['overall_feeling', 'primary_concern'], // Sorted
        p_locale: 'cs',
      });
      expect(result.current.data).toHaveLength(2);
    });

    it('validates and parses block config correctly', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['primary_concern']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const block = result.current.data?.[0];
      expect(block?.block_code).toBe('primary_concern');
      expect(block?.question_type).toBe('tags');
      expect(block?.translatedText).toBe('Co vás nejvíce trápí?');
      expect(block?.config).not.toBeNull();
      // Config should be validated
      const config = block?.config as { options: Array<{ value: string }> };
      expect(config?.options).toHaveLength(3);
      expect(config?.options?.[0]?.value).toBe('immunity');
    });

    it('parses optionTranslations from RPC response', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['primary_concern']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const block = result.current.data?.[0];
      // optionTranslations should be parsed from option_translations field
      expect(block?.optionTranslations).toBeDefined();
      expect(block?.optionTranslations?.['tags.immunity']).toBe('Imunita (DB)');
      expect(block?.optionTranslations?.['tags.energy']).toBe('Energie (DB)');
      expect(block?.optionTranslations?.['tags.aging']).toBe('Stárnutí (DB)');
    });

    it('handles empty optionTranslations gracefully', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockScaleBlock], // scale block has empty option_translations
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['energy_perception']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const block = result.current.data?.[0];
      expect(block?.optionTranslations).toEqual({});
    });

    it('sorts blocks by display_order', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockScaleBlock, mockBlockData, mockFeelingPresetBlock], // Out of order
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['primary_concern', 'overall_feeling', 'energy_perception'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.[0]?.display_order).toBe(1);
      expect(result.current.data?.[1]?.display_order).toBe(2);
      expect(result.current.data?.[2]?.display_order).toBe(3);
    });

    it('returns empty array for empty codes', () => {
      const { result } = renderHookWithProviders(() => useQuestionBlocks([]));

      // Query is disabled when codes is empty, so status stays pending/idle
      expect(result.current.fetchStatus).toBe('idle');
      expect(result.current.data).toBeUndefined();
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['test']));

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('skips invalid blocks and continues', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [
          mockBlockData,
          { id: 'invalid' }, // Invalid - missing required fields
          mockFeelingPresetBlock,
        ],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['primary_concern', 'invalid', 'overall_feeling'])
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Should have 2 valid blocks, invalid one skipped
      expect(result.current.data).toHaveLength(2);
    });

    it('uses translated_text when available', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['primary_concern']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.[0]?.translatedText).toBe('Co vás nejvíce trápí?');
    });

    it('falls back to text_key when translation is null', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{
          ...mockBlockData,
          translated_text: null,
        }],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['primary_concern']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.[0]?.translatedText).toBe('onboarding.primary_concern');
    });

    it('respects enabled option', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocks(['primary_concern'], { enabled: false })
      );

      expect(result.current.fetchStatus).toBe('idle');
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('useQuestionBlock', () => {
    it('fetches single block by code', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlock('primary_concern'));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.block?.block_code).toBe('primary_concern');
    });

    it('returns null when block not found', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlock('nonexistent'));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.block).toBeNull();
    });
  });

  describe('useQuestionBlocksForContext', () => {
    it('fetches onboarding blocks via context_type RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData, mockFeelingPresetBlock, mockScaleBlock],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('onboarding')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_question_blocks_by_context_type', {
        p_context_type: 'onboarding',
        p_locale: 'cs',
      });
    });

    it('fetches check_in blocks via context_type RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockScaleBlock],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('check_in')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_question_blocks_by_context_type', {
        p_context_type: 'check_in',
        p_locale: 'cs',
      });
    });

    it('returns empty for unknown context', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useQuestionBlocksForContext('unknown_context')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_question_blocks_by_context_type', {
        p_context_type: 'unknown_context',
        p_locale: 'cs',
      });
      expect(result.current.data).toEqual([]);
    });
  });

  describe('Block config validation', () => {
    it('validates tags config', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBlockData],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['primary_concern']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const config = result.current.data?.[0]?.config as {
        multiSelect: boolean;
        options: Array<{ value: string }>;
        layout: string;
      };
      expect(config.multiSelect).toBe(false);
      expect(config.options).toBeInstanceOf(Array);
      expect(config.layout).toBe('grid');
    });

    it('validates feeling_preset config', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockFeelingPresetBlock],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['overall_feeling']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const config = result.current.data?.[0]?.config as {
        presets: Array<{ id: string; values: Record<string, number> }>;
        showLabels: boolean;
        size: string;
      };
      expect(config.presets).toHaveLength(3);
      expect(config.presets[0].values).toHaveProperty('energy');
      expect(config.showLabels).toBe(true);
      expect(config.size).toBe('lg');
    });

    it('validates scale config', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockScaleBlock],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['energy_perception']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const config = result.current.data?.[0]?.config as {
        min: number;
        max: number;
        step: number;
        showValue: boolean;
      };
      expect(config.min).toBe(0);
      expect(config.max).toBe(10);
      expect(config.step).toBe(1);
      expect(config.showValue).toBe(true);
    });

    it('sets config to null for invalid config', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [{
          ...mockBlockData,
          config: { invalid: 'config' }, // Missing required options
        }],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useQuestionBlocks(['primary_concern']));

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Should still parse block but config will be null
      expect(result.current.data?.[0]?.config).toBeNull();
      expect(result.current.data?.[0]?.rawConfig).toEqual({ invalid: 'config' });
    });
  });
});
