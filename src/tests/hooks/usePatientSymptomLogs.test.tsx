import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseSession = vi.fn();

vi.mock('@/hooks/useSession', () => ({
  useSession: () => mockUseSession(),
}));
vi.mock('./useSession', () => ({
  useSession: () => mockUseSession(),
}));

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: hoisted.rpcMock,
  },
}));

import {
  useUserSymptomLogs,
  type SymptomLog,
} from '@/hooks/useUserTracking';

const MOCK_SYMPTOM_LOGS: SymptomLog[] = [
  {
    category: 'pain',
    ended_at: '2026-01-15T10:00:00.000Z',
    id: '00000000-0000-4000-8000-000000000001',
    logged_at: '2026-01-15T08:00:00.000Z',
    notes: 'Morning headache after exercise',
    severity: 6,
    started_at: '2026-01-15T06:00:00.000Z',
    symptom_code: 'headache',
    symptom_name: 'Headache',
  },
  {
    category: 'digestive',
    ended_at: null,
    id: '00000000-0000-4000-8000-000000000002',
    logged_at: '2026-01-14T14:00:00.000Z',
    notes: null,
    severity: 3,
    started_at: '2026-01-14T12:00:00.000Z',
    symptom_code: 'nausea',
    symptom_name: 'Nausea',
  },
];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useUserSymptomLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: { id: 'consultant-1' },
      isLoading: false,
      roles: ['practitioner'],
      hasRole: vi.fn(() => true),
      isAdmin: false,
      signOut: vi.fn(),
      refetchRoles: vi.fn(),
      session: { user: { id: 'consultant-1' } },
    });
  });

  it('should not fetch when consent is not granted', () => {
    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'none'),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it('should not fetch when userId is null', () => {
    const { result } = renderHook(
      () => useUserSymptomLogs(null, 'granted'),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it('should fetch symptom logs when consent is granted', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: MOCK_SYMPTOM_LOGS,
      error: null,
    });

    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'granted'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      'get_user_symptom_logs_audited',
      { p_user_id: 'user-1' },
    );

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]).toEqual(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        symptom_name: 'Headache',
        severity: 6,
        category: 'pain',
      }),
    );
  });

  it('should return parsed data with correct types', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: MOCK_SYMPTOM_LOGS,
      error: null,
    });

    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'granted'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const ongoingLog = result.current.data?.find((l) => l.id === '00000000-0000-4000-8000-000000000002');
    expect(ongoingLog?.ended_at).toBeNull();
    expect(ongoingLog?.notes).toBeNull();
    expect(ongoingLog?.severity).toBe(3);
    expect(ongoingLog?.started_at).toBe('2026-01-14T12:00:00.000Z');
  });

  it('should handle RPC error gracefully', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Access denied', code: 'P0001' },
    });

    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'granted'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('should return empty array when no data', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'granted'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should return empty array when data is null', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'granted'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should not fetch when consent is pending', () => {
    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'pending'),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it('should not fetch when consent is revoked', () => {
    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'revoked'),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it('should not leak sensitive data in error messages', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Access denied', code: 'P0001' },
    });

    const { result } = renderHook(
      () => useUserSymptomLogs('user-1', 'granted'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Verify no sensitive data is logged — error logs should use safeError
    for (const call of consoleSpy.mock.calls) {
      const logStr = JSON.stringify(call);
      expect(logStr).not.toContain('user-1');
    }

    consoleSpy.mockRestore();
  });
});
