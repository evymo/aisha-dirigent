import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAdminDeletionRequests } from '@/hooks/useAdminDeletionRequests';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

describe('useAdminDeletionRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no data', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useAdminDeletionRequests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should call RPC with default parameters', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useAdminDeletionRequests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalled();
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'get_account_deletion_requests_admin',
      expect.objectContaining({
        p_limit: 50,
        p_offset: 0,
        p_status: undefined,
      })
    );
  });

  it('should pass custom parameters', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useAdminDeletionRequests({ limit: 10, offset: 20, status: 'pending' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalled();
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'get_account_deletion_requests_admin',
      expect.objectContaining({
        p_limit: 10,
        p_offset: 20,
        p_status: 'pending',
      })
    );
  });

  it('should map response data correctly', async () => {
    const mockResponse = [
      {
        id: 'req-1',
        user_id: 'user-1',
        user_email: 'test@example.com',
        display_name: 'Test User',
        reason: 'Privacy concerns',
        feedback: 'Too many emails',
        requested_at: '2026-01-15T10:00:00Z',
        scheduled_deletion_at: '2026-02-14T10:00:00Z',
        cancelled_at: null,
        completed_at: null,
        status: 'pending',
        processed_by: null,
      },
    ];

    mockRpc.mockResolvedValue({ data: mockResponse, error: null });

    const { result } = renderHook(() => useAdminDeletionRequests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    const req = result.current.data?.[0];
    expect(req?.id).toBe('req-1');
    expect(req?.user_email).toBe('test@example.com');
    expect(req?.display_name).toBe('Test User');
    expect(req?.reason).toBe('Privacy concerns');
    expect(req?.status).toBe('pending');
    expect(req?.cancelled_at).toBeNull();
  });

  it('should handle RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Unauthorized' } });

    const { result } = renderHook(() => useAdminDeletionRequests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Unauthorized');
  });

  it('should handle null data gracefully', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useAdminDeletionRequests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should include status filter in query key for cache separation', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result: result1 } = renderHook(
      () => useAdminDeletionRequests({ status: 'pending' }),
      { wrapper: createWrapper() }
    );

    const { result: result2 } = renderHook(
      () => useAdminDeletionRequests({ status: 'cancelled' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });
  });
});
