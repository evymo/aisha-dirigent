import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTokenLocks } from '@/hooks/useTokenomics';

const hoisted = vi.hoisted(() => {
  const rpcMock = vi.fn();
  return { rpcMock };
});

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: hoisted.rpcMock,
  },
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (perm: string) => perm === 'view_admin_dashboard',
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useTokenLocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch token locks via admin RPC and map profile fields', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [
        {
          id: 'lock-1',
          user_id: 'user-1',
          token_type: 'aisha',
          amount: 100,
          lock_reason: 'vesting',
          lock_start: '2025-01-01T00:00:00Z',
          lock_end: '2026-01-01T00:00:00Z',
          unlock_schedule: 'cliff',
          unlocked_amount: 0,
          is_active: true,
          notes: null,
          created_by: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          profile_display_name: 'Alice',
          profile_email: 'alice@example.com',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useTokenLocks(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_token_locks_admin');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].profile?.display_name).toBe('Alice');
    expect(result.current.data?.[0].profile?.email).toBe('alice@example.com');
  });

  it('should surface RPC errors', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Not authorized' },
    });

    const { result } = renderHook(() => useTokenLocks(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(String((result.current.error as Error)?.message || '')).toMatch(/Not authorized/i);
  });
});
