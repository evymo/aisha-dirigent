import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, act } from '@testing-library/react';
import { renderHookWithProviders, createTestQueryClient } from '../utils/test-utils';

const permissionsHoisted = vi.hoisted(() => ({
  hasPermissionMock: vi.fn((permission: string) => permission === 'manage_users'),
  hasAnyPermissionMock: vi.fn(() => true),
}));

const hoisted = vi.hoisted(() => {
  const orderMock = vi.fn();
  const selectMock = vi.fn();
  const insertMock = vi.fn();
  const insertSelectMock = vi.fn();
  const insertSingleMock = vi.fn();
  const updateMock = vi.fn();
  const eqMock = vi.fn();
  const rpcMock = vi.fn();

  return {
    orderMock,
    selectMock,
    insertMock,
    insertSelectMock,
    insertSingleMock,
    updateMock,
    eqMock,
    rpcMock,
  };
});

const safeErrorMock = vi.fn();
const userFacingMock = vi.fn(() => 'User-facing error');

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: (context: string, error?: unknown) => safeErrorMock(context, error),
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

vi.mock('@/lib/security/userFacingErrors', () => ({
  getUserFacingDataErrorMessage: () => userFacingMock(),
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    user: { id: 'user-1' },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    isLoading: false,
    hasPermission: permissionsHoisted.hasPermissionMock,
    hasAnyPermission: permissionsHoisted.hasAnyPermissionMock,
    hasAllPermissions: vi.fn(() => true),
  }),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'invitations') {
        return {
          select: hoisted.selectMock,
          insert: hoisted.insertMock,
          update: hoisted.updateMock,
        };
      }
      return { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    }),
    rpc: vi.fn((...args) => hoisted.rpcMock(...args)),
  },
}));

import { useInvitations } from '@/hooks/useInvitations';

describe('useInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: admin RPC returns empty list
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    permissionsHoisted.hasPermissionMock.mockImplementation((permission: string) => permission === 'manage_users');
    permissionsHoisted.hasAnyPermissionMock.mockReturnValue(true);
  });

  it('fetches invitations successfully', async () => {
    // RPC returns invitations in RpcInvitation format
    const rpcInvitations = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        code: 'ABC',
        study_id: null,
        role: 'member',
        email: null,
        created_by: '00000000-0000-0000-0000-000000000002',
        created_at: new Date().toISOString(),
        expires_at: null,
        max_uses: null,
        used_count: 0,
        is_active: true,
        prefill_first_name: null,
        prefill_last_name: null,
        prefill_phone: null,
        prefill_notes: null,
        study_name: 'Study 1',
      },
    ];

    // Expected output after mapping in hook
    const expectedInvitations = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        code: 'ABC',
        claims: [],
        study_id: null,
        role: 'member',
        email: null,
        created_by: '00000000-0000-0000-0000-000000000002',
        created_at: rpcInvitations[0].created_at,
        expires_at: null,
        max_uses: null,
        used_count: 0,
        is_active: true,
        prefill_first_name: null,
        prefill_last_name: null,
        prefill_phone: null,
        prefill_notes: null,
        study: { name: 'Study 1' },
      },
    ];

    // Mock RPC to return invitations
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_invitations_admin') {
        return Promise.resolve({ data: rpcInvitations, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHookWithProviders(() => useInvitations());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.invitations).toEqual(expectedInvitations);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_invitations_admin');
  });

  it('records query error via safeError and surfaces react-query error state', async () => {
    // Mock RPC to return error
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_invitations_admin') {
        return Promise.resolve({ data: null, error: { status: 403, message: 'Forbidden' } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const queryClient = createTestQueryClient();

    const { result } = renderHookWithProviders(() => useInvitations(), { queryClient });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.invitations).toEqual([]);
    });

    // Fail-closed: permission denied should not surface an error state.
    expect(safeErrorMock).toHaveBeenCalledWith('Invitations.fetch', expect.anything());
    expect(userFacingMock).not.toHaveBeenCalled();
  });

  it('calls createInvitation RPC and invalidates invitations query', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const newInvitation = {
      id: 'inv-2',
      code: 'HELLO',
      study_id: null,
      role: null,
      email: 'test@example.com',
      created_by: 'user-1',
      created_at: new Date().toISOString(),
      expires_at: null,
      max_uses: null,
      used_count: 0,
      is_active: true,
    };

    // Mock RPC for all operations
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_invitations_admin') {
        return Promise.resolve({ data: [], error: null });
      }
      if (fnName === 'create_invitation') {
        return Promise.resolve({ data: newInvitation, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHookWithProviders(() => useInvitations(), { queryClient });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createInvitation.mutateAsync({
        code: '  hello ',
        email: ' test@example.com  ',
      });
    });

    // Verify RPC was called - sanitization happens in DB function
    expect(hoisted.rpcMock).toHaveBeenCalledWith('create_invitation', expect.objectContaining({
      p_code: '  hello ',
      p_email: ' test@example.com  ',
    }));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['invitations'] });
  });

  it('toggles invitation active state and invalidates invitations query', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Mock RPC for all operations
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'get_invitations_admin') {
        return Promise.resolve({ data: [], error: null });
      }
      if (fnName === 'toggle_invitation') {
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHookWithProviders(() => useInvitations(), { queryClient });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleInvitation.mutateAsync({ id: 'inv-1', is_active: false });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('toggle_invitation', {
      p_invitation_id: 'inv-1',
      p_is_active: false,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['invitations'] });
  });
});
