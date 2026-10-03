import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateTokenLock } from '@/hooks/useTokenomics';
import { mockAdminPermissions } from '@/tests/utils/permissions';

const hoisted = vi.hoisted(() => {
  const rpcMock = vi.fn();
  const toastMock = Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  });
  return { rpcMock, toastMock };
});

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: hoisted.rpcMock,
  },
}));

vi.mock("sonner", () => ({
  toast: hoisted.toastMock,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useUpdateTokenLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminPermissions();
  });

  it('should call update_token_lock_admin RPC with expected params', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [
        {
          id: 'lock-1',
          user_id: 'user-1',
          token_type: 'aisha',
          amount: 150,
          lock_reason: 'manual',
          lock_start: '2025-01-01T00:00:00Z',
          lock_end: '2026-06-01T00:00:00Z',
          unlock_schedule: 'linear',
          unlocked_amount: 10,
          is_active: true,
          notes: null,
          created_by: 'admin-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-02-01T00:00:00Z',
          profile_display_name: 'Alice',
          profile_email: 'alice@example.com',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useUpdateTokenLock(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'lock-1',
        updates: {
          amount: 150,
          lock_end: '2026-06-01T00:00:00Z',
          unlock_schedule: 'linear',
          unlocked_amount: 10,
        } as never,
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('update_token_lock_admin', {
      p_lock_id: 'lock-1',
      p_amount: 150,
      p_lock_end: '2026-06-01T00:00:00Z',
      p_unlock_schedule: 'linear',
      p_unlocked_amount: 10,
      p_is_active: undefined,
      p_lock_reason: undefined,
      p_notes: undefined,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('should show generic error toast on RPC failure (no backend details)', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Token lock not found: internal detail' },
    });

    const { result } = renderHook(() => useUpdateTokenLock(), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'lock-missing', updates: {} })).rejects.toBeTruthy();
    });

    expect(hoisted.toastMock.error).toHaveBeenCalled();

    // Make sure we don't pass raw backend error details through.
    hoisted.toastMock.error.mock.calls.forEach((call: unknown[]) => {
      expect(JSON.stringify(call)).not.toMatch(/Not authorized/i);
    });
  });
});
