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
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

import {
  useEffectiveDistribution,
  useDistributionAdjustments,
  useEffectiveDistributionForUser,
  type DistributionAdjustment,
  type EffectiveDistribution,
  type CreateDistributionAdjustmentParams,
} from '@/hooks/useDistributionAdjustments';

// Mock data matching Zod schemas (UUIDs required for protocol_id)
const mockEffectiveDistribution: EffectiveDistribution = {
  protocol_id: '550e8400-e29b-41d4-a716-446655440001',
  product_name: 'Retisin',
  study_name: 'Study Alpha',
  arm_code: 'ARM-A',
  dose_amount: 10,
  dose_unit: 'mg',
  doses_per_day: 2,
  dose_timing: ['08:00', '20:00'],
  has_adjustment: false,
  adjustment_type: null,
  adjustment_reason: null,
  effective_from: null,
  effective_until: null,
};

const mockEffectiveDistributionWithAdjustment: EffectiveDistribution = {
  ...mockEffectiveDistribution,
  has_adjustment: true,
  adjustment_type: 'dose_decrease',
  adjustment_reason: 'Side effects',
  effective_from: '2024-01-15',
  effective_until: null,
};

const mockDistributionAdjustment: DistributionAdjustment = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  member_token: 'member-token-123',
  protocol_id: '550e8400-e29b-41d4-a716-446655440001',
  adjustment_type: 'dose_decrease',
  new_dose_amount: 5,
  new_doses_per_day: 1,
  new_dose_timing: ['08:00'],
  new_arm_code: null,
  effective_from: '2024-01-15',
  effective_until: null,
  reason: 'Side effects reported',
  authorized_by: '550e8400-e29b-41d4-a716-446655440002',
  consultant_note: 'Reduce dose for 2 weeks',
  is_active: true,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

describe('useDistributionAdjustments hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
  });

  describe('useEffectiveDistribution', () => {
    it('fetches effective distribution for current member via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockEffectiveDistribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_effective_distribution');
      expect(result.current.effectiveDistributions).toHaveLength(1);
      expect(result.current.effectiveDistributions[0].product_name).toBe('Retisin');
      expect(result.current.hasAdjustments).toBe(false);
    });

    it('detects hasAdjustments when adjustment exists', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockEffectiveDistributionWithAdjustment],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.hasAdjustments).toBe(true);
      expect(result.current.effectiveDistributions[0].adjustment_type).toBe('dose_decrease');
    });

    it('handles fetch error gracefully', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.effectiveDistributions).toEqual([]);
    });

    it('returns empty array when no distributions exist', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.effectiveDistributions).toEqual([]);
      expect(result.current.hasAdjustments).toBe(false);
    });
  });

  describe('useDistributionAdjustments', () => {
    it('fetches distribution adjustments for member token via audited RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockDistributionAdjustment],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useDistributionAdjustments('member-token-123')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_distribution_adjustments_audited', {
        p_member_token: 'member-token-123',
      });
      expect(result.current.adjustments).toHaveLength(1);
      expect(result.current.adjustments[0].adjustment_type).toBe('dose_decrease');
    });

    it('handles fetch error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Access denied' },
      });

      const { result } = renderHookWithProviders(() =>
        useDistributionAdjustments('member-token-123')
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    describe('createAdjustment mutation', () => {
      it('creates distribution adjustment via RPC', async () => {
        // First call for query, second for mutation
        hoisted.rpcMock
          .mockResolvedValueOnce({ data: [], error: null }) // initial fetch
          .mockResolvedValueOnce({ data: 'new-adjustment-id', error: null }); // create

        const { result, queryClient } = renderHookWithProviders(() =>
          useDistributionAdjustments('member-token-123')
        );
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        await waitFor(() => {
          expect(result.current.isSuccess).toBe(true);
        });

        const params: CreateDistributionAdjustmentParams = {
          memberToken: 'member-token-123',
          adjustmentType: 'dose_decrease',
          reason: 'Side effects',
          newDoseAmount: 5,
          newDosesPerDay: 1,
        };

        await result.current.createAdjustment.mutateAsync(params);

        expect(hoisted.rpcMock).toHaveBeenCalledWith('create_distribution_adjustment', {
          p_member_token: 'member-token-123',
          p_adjustment_type: 'dose_decrease',
          p_reason: 'Side effects',
          p_effective_from: expect.any(String),
          p_effective_until: undefined,
          p_new_dose_amount: 5,
          p_new_doses_per_day: 1,
          p_new_dose_timing: undefined,
          p_new_arm_code: undefined,
          p_protocol_id: undefined,
          p_consultant_note: undefined,
        });

        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['distribution-adjustments'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-effective-distribution'] });
      });

      it('handles create error', async () => {
        hoisted.rpcMock
          .mockResolvedValueOnce({ data: [], error: null })
          .mockResolvedValueOnce({ data: null, error: { message: 'Create failed' } });

        const { result } = renderHookWithProviders(() =>
          useDistributionAdjustments('member-token-123')
        );

        await waitFor(() => {
          expect(result.current.isSuccess).toBe(true);
        });

        const params: CreateDistributionAdjustmentParams = {
          memberToken: 'member-token-123',
          adjustmentType: 'dose_decrease',
          reason: 'Test',
        };

        await expect(result.current.createAdjustment.mutateAsync(params)).rejects.toThrow();
      });

      it('validates response is valid UUID', async () => {
        hoisted.rpcMock
          .mockResolvedValueOnce({ data: [], error: null })
          .mockResolvedValueOnce({ data: '', error: null }); // Invalid empty response

        const { result } = renderHookWithProviders(() =>
          useDistributionAdjustments('member-token-123')
        );

        await waitFor(() => {
          expect(result.current.isSuccess).toBe(true);
        });

        const params: CreateDistributionAdjustmentParams = {
          memberToken: 'member-token-123',
          adjustmentType: 'dose_decrease',
          reason: 'Test',
        };

        await expect(result.current.createAdjustment.mutateAsync(params)).rejects.toThrow(
          'Invalid response from create_distribution_adjustment'
        );
      });
    });

    describe('deactivateAdjustment mutation', () => {
      it('deactivates distribution adjustment via audited RPC', async () => {
        hoisted.rpcMock
          .mockResolvedValueOnce({ data: [mockDistributionAdjustment], error: null })
          .mockResolvedValueOnce({ data: true, error: null });

        const { result, queryClient } = renderHookWithProviders(() =>
          useDistributionAdjustments('member-token-123')
        );
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        await waitFor(() => {
          expect(result.current.isSuccess).toBe(true);
        });

        await result.current.deactivateAdjustment.mutateAsync('adjustment-id-123');

        expect(hoisted.rpcMock).toHaveBeenCalledWith('deactivate_distribution_adjustment_audited', {
          p_adjustment_id: 'adjustment-id-123',
        });

        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['distribution-adjustments'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-effective-distribution'] });
      });

      it('handles deactivate error', async () => {
        hoisted.rpcMock
          .mockResolvedValueOnce({ data: [mockDistributionAdjustment], error: null })
          .mockResolvedValueOnce({ data: null, error: { message: 'Deactivate failed' } });

        const { result } = renderHookWithProviders(() =>
          useDistributionAdjustments('member-token-123')
        );

        await waitFor(() => {
          expect(result.current.isSuccess).toBe(true);
        });

        await expect(
          result.current.deactivateAdjustment.mutateAsync('adjustment-id-123')
        ).rejects.toThrow();
      });
    });

    describe('refresh function', () => {
      it('invalidates distribution-adjustments queries', async () => {
        hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

        const { result, queryClient } = renderHookWithProviders(() =>
          useDistributionAdjustments('member-token-123')
        );
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        await waitFor(() => {
          expect(result.current.isSuccess).toBe(true);
        });

        result.current.refresh();

        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['distribution-adjustments'] });
      });
    });
  });

  describe('useEffectiveDistributionForUser', () => {
    it('fetches effective distribution for specific user via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockEffectiveDistribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useEffectiveDistributionForUser('member-token-456')
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_effective_distribution', {
        p_member_token: 'member-token-456',
      });
      expect(result.current.effectiveDistributions).toHaveLength(1);
    });

    it('does not fetch when memberToken is undefined', async () => {
      const { result } = renderHookWithProviders(() =>
        useEffectiveDistributionForUser(undefined)
      );

      // Query is disabled when memberToken is undefined
      expect(result.current.status).toBe('pending');
      expect(result.current.fetchStatus).toBe('idle');
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('handles fetch error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'User not found' },
      });

      const { result } = renderHookWithProviders(() =>
        useEffectiveDistributionForUser('invalid-token')
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.effectiveDistributions).toEqual([]);
    });
  });
});
