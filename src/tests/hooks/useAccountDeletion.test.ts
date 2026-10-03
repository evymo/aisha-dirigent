import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAccountDeletion } from '@/hooks/useAccountDeletion';

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
const mockToast = vi.hoisted(() => Object.assign(vi.fn(), {
  success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
  loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
}));
const mockUser = vi.hoisted(() => ({ current: { id: 'user-1' } as { id: string } | null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ user: mockUser.current }),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

describe('useAccountDeletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = { id: 'user-1' };
  });

  it('should not call RPC when user is not authenticated', async () => {
    mockUser.current = null;
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    // Wait a tick to ensure query would have fired if enabled
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.pendingRequest).toBeUndefined();
  });

  it('should return null when no pending request exists', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.pendingRequest).toBeNull();
  });

  it('should return pending request when one exists', async () => {
    const mockRequest = {
      id: 'req-1',
      requested_at: '2026-01-15T10:00:00Z',
      scheduled_deletion_at: '2026-02-14T10:00:00Z',
      reason: 'Privacy concerns',
      status: 'pending',
    };

    mockRpc.mockResolvedValue({ data: [mockRequest], error: null });

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.pendingRequest).toEqual(mockRequest);
    expect(result.current.pendingRequest?.status).toBe('pending');
  });

  it('should call get_my_account_deletion_request RPC', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_my_account_deletion_request');
    });
  });

  it('should call request_account_deletion RPC on requestDeletion', async () => {
    // First call for query, subsequent for mutation
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null }) // initial query
      .mockResolvedValueOnce({
        data: { success: true, request_id: 'req-new', scheduled_deletion_at: '2026-02-15T10:00:00Z', message: 'ok' },
        error: null,
      }); // mutation

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.requestDeletion({ reason: 'Test', feedback: 'None' });
    });

    expect(mockRpc).toHaveBeenCalledWith('request_account_deletion', {
      p_feedback: 'None',
      p_reason: 'Test',
    });
  });

  it('should call cancel_account_deletion RPC on cancelDeletion', async () => {
    const mockRequest = {
      id: 'req-1',
      requested_at: '2026-01-15T10:00:00Z',
      scheduled_deletion_at: '2026-02-14T10:00:00Z',
      reason: null,
      status: 'pending',
    };

    mockRpc
      .mockResolvedValueOnce({ data: [mockRequest], error: null }) // initial query
      .mockResolvedValueOnce({
        data: { success: true, request_id: 'req-1', scheduled_deletion_at: '', message: 'cancelled' },
        error: null,
      }); // cancel mutation

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.pendingRequest).toBeTruthy();
    });

    await act(async () => {
      await result.current.cancelDeletion();
    });

    expect(mockRpc).toHaveBeenCalledWith('cancel_account_deletion');
  });

  it('should show toast on successful request', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: { success: true, request_id: 'req-new', scheduled_deletion_at: '2026-02-15', message: 'ok' },
        error: null,
      });

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.requestDeletion({});
    });

    expect(mockToast.success).toHaveBeenCalled();
  });

  it('should show error toast on request failure', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Server error' } });

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    try {
      await act(async () => {
        await result.current.requestDeletion({});
      });
    } catch {
      // Expected to throw
    }

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('should handle query error gracefully', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(() => useAccountDeletion(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});
