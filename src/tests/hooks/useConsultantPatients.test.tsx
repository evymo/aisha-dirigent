import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createChainableMock } from '@/tests/mocks/db';
import { useUserTrackingData } from '@/hooks/useConsultantUsers';

const mockUseSession = vi.fn();

// Mock both paths since hook uses relative import "./useSession"
vi.mock('@/hooks/useSession', () => ({
  useSession: () => mockUseSession(),
}));
vi.mock('./useSession', () => ({
  useSession: () => mockUseSession(),
}));

const hoisted = vi.hoisted(() => {
  const fromMock = vi.fn((_table: string) => {
    const defaultResponse = { data: [] as unknown[], error: null };
    return createChainableMock(defaultResponse as unknown as { data: null; error: null });
  });

  const rpcMock = vi.fn(async (fn: string) => {
    if (fn === 'get_user_dosing_logs_summary_audited') {
      return {
        data: [
          {
            id: 'dose-1',
            logged_at: '2025-01-01T00:00:00.000Z',
            dose_amount: '10',
            dose_count: 1,
            notes: 'should-not-leak',
          },
        ],
        error: null,
      };
    }

    return { data: [], error: null };
  });

  return { fromMock, rpcMock };
});

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: hoisted.fromMock,
    rpc: hoisted.rpcMock,
  },
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

describe('useUserTrackingData', () => {
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

  it('should not select dosing log notes by default', async () => {
    const { result } = renderHook(() => useUserTrackingData('user-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const tables = hoisted.fromMock.mock.calls.map(call => call[0]);
    expect(tables).not.toContain('dosing_logs');

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_user_dosing_logs_summary_audited', {
      p_user_id: 'user-123',
    });

    const firstDose = result.current.data?.dosingLogs?.[0];
    expect(firstDose).toBeTruthy();
    expect(firstDose).not.toHaveProperty('notes');
  });
});
