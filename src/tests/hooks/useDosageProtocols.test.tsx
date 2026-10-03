import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/tests/utils/test-utils';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));

import {
  useMyEffectiveDistribution,
  useMyDistributionPlans,
  useProductDistributionInfo,
  calculateBottleDuration,
  DOSAGE_TIERS,
  type EffectiveDistribution,
  type DistributionPlan,
} from '@/hooks/useDistributionProtocols';

const mockUser = { id: 'user-123' };

const mockEffectiveDistribution: EffectiveDistribution = {
  product_id: '550e8400-e29b-41d4-a716-446655440001',
  product_name: 'Retisin',
  protocol_id: '550e8400-e29b-41d4-a716-446655440010',
  protocol_name: 'Standard Protocol',
  dose_amount: 10,
  dose_unit: 'drops',
  doses_per_day: 2,
  dose_timing: ['morning', 'evening'],
  arm_code: 'A',
  source: 'study',
  study_name: 'Test Study',
  ml_per_day: 1,
  ml_per_month: 30,
  bottle_lasts_days: 30,
};

const mockDistributionPlan: DistributionPlan = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  protocol_id: '550e8400-e29b-41d4-a716-446655440010',
  protocol: null,
  custom_dose_amount: null,
  custom_doses_per_day: null,
  custom_instructions: null,
  starts_at: '2024-01-01',
  ends_at: null,
  status: 'active',
  compliance_target: 80,
  compensation_percentage: 100,
  is_vip: false,
};

describe('useDistributionProtocols hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ user: mockUser });
  });

  describe('useMyEffectiveDistribution', () => {
    it('fetches effective distributions via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockEffectiveDistribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_effective_distribution');
      expect(result.current.distributions).toHaveLength(1);
      expect(result.current.distributions[0].product_name).toBe('Retisin');
    });

    it('returns empty array when not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useMyEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.distributions).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useMyEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).not.toBeNull();
    });

    it('handles null response', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyEffectiveDistribution());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.distributions).toEqual([]);
    });
  });

  describe('useMyDistributionPlans', () => {
    it('fetches distribution plans via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockDistributionPlan],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useMyDistributionPlans());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_distribution_plans');
      expect(result.current.plans).toHaveLength(1);
      expect(result.current.plans[0].status).toBe('active');
    });

    it('returns empty array when not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useMyDistributionPlans());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.plans).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useMyDistributionPlans());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).not.toBeNull();
    });
  });

  describe('useProductDistributionInfo', () => {
    it('returns product-specific distribution when found', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockEffectiveDistribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductDistributionInfo('550e8400-e29b-41d4-a716-446655440001')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.hasCustomDistribution).toBe(true);
      expect(result.current.distribution?.product_name).toBe('Retisin');
    });

    it('returns default distribution for unknown product', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockEffectiveDistribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductDistributionInfo('unknown-product-id')
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.hasCustomDistribution).toBe(false);
      expect(result.current.distribution).toBeUndefined();
      expect(result.current.defaultDistribution.ml_per_day).toBe(1);
    });

    it('handles undefined productId', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockEffectiveDistribution],
        error: null,
      });

      const { result } = renderHookWithProviders(() =>
        useProductDistributionInfo(undefined)
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.hasCustomDistribution).toBe(false);
      expect(result.current.distribution).toBeNull();
    });

    it('reports authentication status', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      const { result } = renderHookWithProviders(() =>
        useProductDistributionInfo('some-id')
      );

      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('calculateBottleDuration', () => {
    it('calculates duration for drops (22 drops/ml calibration)', () => {
      const result = calculateBottleDuration(10, 2, 'drops', 30);

      // 10 drops × (1/22 ml) ≈ 0.4545 ml per dose, × 2 = ~0.909 ml/day
      expect(result.mlPerDay).toBeCloseTo(0.909, 2);
      expect(result.daysPerBottle).toBe(33); // floor(30 / 0.909)
      expect(result.bottlesPerMonth).toBe(1);
    });

    it('calculates duration for ml', () => {
      const result = calculateBottleDuration(1, 3, 'ml', 30);

      // 1ml * 3 = 3ml/day
      expect(result.mlPerDay).toBe(3);
      expect(result.daysPerBottle).toBe(10);
      expect(result.bottlesPerMonth).toBe(3);
    });

    it('calculates duration for sprays (5.33 sprays/ml calibration)', () => {
      const result = calculateBottleDuration(5, 2, 'sprays', 30);

      // 5 sprays × 0.1875 ml = 0.9375 ml per dose, × 2 = 1.875 ml/day
      expect(result.mlPerDay).toBeCloseTo(1.875, 3);
      expect(result.daysPerBottle).toBe(16); // floor(30 / 1.875)
    });

    it('handles zero dose', () => {
      const result = calculateBottleDuration(0, 0, 'drops', 30);

      expect(result.mlPerDay).toBe(0);
      expect(result.daysPerBottle).toBe(0);
      expect(result.bottlesPerMonth).toBe(1);
    });

    it('accepts custom dropsPerMl from DB', () => {
      const result = calculateBottleDuration(10, 2, 'drops', 30, 20);

      // 10 drops × (1/20 ml) = 0.5 ml per dose, × 2 = 1 ml/day
      expect(result.mlPerDay).toBe(1);
      expect(result.daysPerBottle).toBe(30);
      expect(result.bottlesPerMonth).toBe(1);
    });
  });

  describe('DOSAGE_TIERS', () => {
    it('contains all expected tiers', () => {
      expect(DOSAGE_TIERS.verification.mlPerDay).toBe(0.5);
      expect(DOSAGE_TIERS.maintenance.mlPerDay).toBe(1);
      expect(DOSAGE_TIERS.longevity.mlPerDay).toBe(1);
      expect(DOSAGE_TIERS.basic.mlPerDay).toBe(2);
      expect(DOSAGE_TIERS.intensive.mlPerDay).toBe(3);
      expect(DOSAGE_TIERS.booster.mlPerDay).toBe(6);
    });

    it('has unique keys', () => {
      const keys = Object.values(DOSAGE_TIERS).map(t => t.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });
});
