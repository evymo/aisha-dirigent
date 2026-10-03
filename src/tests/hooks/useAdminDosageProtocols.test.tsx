import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHookWithProviders } from '@/tests/utils/test-utils';
import {
  useCreateDistributionProtocol,
  useUpdateDistributionProtocol,
} from '@/hooks/useAdminDistributionProtocols';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/hooks/useAdminGuard', () => ({
  useAdminGuard: () => ({
    guardAdminMutation: <TArgs extends unknown[], TResult>(
      _action: string,
      fn: (...args: TArgs) => Promise<TResult>
    ) => fn,
  }),
}));

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

describe('useAdminDistributionProtocols', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockResolvedValue({ error: null });
  });

  it('sends p_id in create mutation payload for RPC parameter consistency', async () => {
    const { result } = renderHookWithProviders(() => useCreateDistributionProtocol());

    await result.current.mutateAsync({
      study_id: null,
      product_id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Protocol A',
      description: 'Baseline distribution',
      dose_amount: 2,
      dose_unit: 'capsule',
      doses_per_day: 1,
      dose_timing: ['morning'],
      arm_code: '',
      is_active: true,
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      'upsert_distribution_protocol_admin',
      expect.objectContaining({
        p_id: undefined,
        p_name: 'Protocol A',
      })
    );
  });

  it('keeps p_id in update mutation payload', async () => {
    const { result } = renderHookWithProviders(() => useUpdateDistributionProtocol());

    await result.current.mutateAsync({
      id: '550e8400-e29b-41d4-a716-446655440099',
      data: {
        name: 'Protocol B',
        is_active: false,
      },
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      'upsert_distribution_protocol_admin',
      expect.objectContaining({
        p_id: '550e8400-e29b-41d4-a716-446655440099',
        p_name: 'Protocol B',
      })
    );
  });
});
