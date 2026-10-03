import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHookWithProviders } from '@/tests/utils/test-utils';
import { useUpdateBatchStatusMutation } from '@/hooks/useAdminProduction';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: hoisted.hasPermissionMock,
  }),
}));

describe('useAdminProduction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockResolvedValue({ error: null });
    hoisted.hasPermissionMock.mockReturnValue(true);
  });

  it('sends full standardized payload when updating batch status', async () => {
    const { result } = renderHookWithProviders(() => useUpdateBatchStatusMutation());

    await result.current.mutateAsync({
      id: '550e8400-e29b-41d4-a716-446655440123',
      status: 'released',
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      'update_production_batch_admin',
      expect.objectContaining({
        p_batch_id: '550e8400-e29b-41d4-a716-446655440123',
        p_status: 'released',
        p_actual_quantity: undefined,
        p_qc_notes: undefined,
      })
    );
  });

  it('blocks admin mutation when user lacks admin permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false);
    const { result } = renderHookWithProviders(() => useUpdateBatchStatusMutation());

    await expect(
      result.current.mutateAsync({
        id: '550e8400-e29b-41d4-a716-446655440123',
        status: 'released',
      })
    ).rejects.toThrow(/Admin permission required/i);

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });
});
