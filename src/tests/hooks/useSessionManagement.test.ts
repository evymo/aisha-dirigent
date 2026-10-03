import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);

let mockSessionReturn: {
  user: { id: string } | null;
  session: { access_token: string } | null;
} = {
  user: { id: 'user-123' },
  session: { access_token: 'access-token-1234567890' },
};

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => mockSessionReturn),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Hoisted mock for aisha.rpc
const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

const setCryptoDigestMock = () => {
  const digest = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer);
  Object.defineProperty(globalThis, 'crypto', {
    value: { subtle: { digest } },
    configurable: true,
  });
  return digest;
};

// Track RPC responses for different functions
let rpcResponses: Record<string, { data: unknown; error: unknown }> = {};

describe('useSessionManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    
    mockSessionReturn = {
      user: { id: '22222222-2222-2222-2222-222222222222' },
      session: { access_token: 'access-token-1234567890' },
    };

    setCryptoDigestMock();

    // Default RPC responses
    rpcResponses = {
      upsert_user_session: { data: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }], error: null },
      update_session_activity: { data: null, error: null },
      get_my_active_sessions: { data: [], error: null },
      terminate_session: { data: null, error: null },
      terminate_all_other_sessions: { data: null, error: null },
    };

    // Setup rpcMock to return appropriate responses based on function name
    hoisted.rpcMock.mockImplementation((fnName: string) => {
      const response = rpcResponses[fnName] || { data: null, error: null };
      return Promise.resolve(response);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('session registration', () => {
    it('registers the current session on mount', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'upsert_user_session',
        expect.objectContaining({
          p_session_id: expect.any(String),
          p_user_agent: expect.any(String),
        }),
      );
    });

    it('does not register when user is null', async () => {
      mockSessionReturn = { user: null, session: null };
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      renderHook(() => useSessionManagement());

      await act(async () => {
        await Promise.resolve();
      });

      expect(hoisted.rpcMock).not.toHaveBeenCalledWith('upsert_user_session', expect.anything());
    });

    it('does not register when session is null', async () => {
      mockSessionReturn = { user: { id: '22222222-2222-2222-2222-222222222222' }, session: null };
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      renderHook(() => useSessionManagement());

      await act(async () => {
        await Promise.resolve();
      });

      expect(hoisted.rpcMock).not.toHaveBeenCalledWith('upsert_user_session', expect.anything());
    });

    it('handles registration error gracefully (non-duplicate)', async () => {
      rpcResponses.upsert_user_session = { 
        data: null, 
        error: { code: '23503', message: 'Foreign key error' } 
      };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.currentSessionId).toBeNull();
    });

    it('ignores duplicate key errors (23505)', async () => {
      rpcResponses.upsert_user_session = { 
        data: null, 
        error: { code: '23505', message: 'Duplicate key' } 
      };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      renderHook(() => useSessionManagement());

      await act(async () => {
        await Promise.resolve();
      });

      // Should not throw or log error for duplicate
      expect(hoisted.rpcMock).toHaveBeenCalledWith('upsert_user_session', expect.anything());
    });

    it('sets currentSessionId when registration succeeds', async () => {
      rpcResponses.upsert_user_session = { data: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }], error: null };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      });
    });

    it('re-registers session when access token changes', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { rerender } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith(
          'upsert_user_session',
          expect.objectContaining({
            p_session_id: expect.any(String),
            p_user_agent: expect.any(String),
          })
        );
      });

      const upsertCallsBefore = hoisted.rpcMock.mock.calls.filter(
        ([fnName]) => fnName === 'upsert_user_session'
      ).length;

      mockSessionReturn = {
        user: { id: '22222222-2222-2222-2222-222222222222' },
        session: { access_token: 'new-access-token-0987654321' },
      };

      rerender();

      await waitFor(() => {
        const upsertCallsAfter = hoisted.rpcMock.mock.calls.filter(
          ([fnName]) => fnName === 'upsert_user_session'
        ).length;
        expect(upsertCallsAfter).toBeGreaterThan(upsertCallsBefore);
      });
    });
  });

  describe('activity updates', () => {
    it('updates session activity on the interval', async () => {
      vi.useFakeTimers();
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000);
        await Promise.resolve();
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('update_session_activity', {
        p_session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      });
    });

    it('does not update activity when currentSessionId is null', async () => {
      rpcResponses.upsert_user_session = { data: null, error: null };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      vi.useFakeTimers();
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      renderHook(() => useSessionManagement());

      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000);
        await Promise.resolve();
      });

      expect(hoisted.rpcMock).not.toHaveBeenCalledWith('update_session_activity', expect.anything());
    });

    it('calls updateActivity manually', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });

      hoisted.rpcMock.mockClear();

      await act(async () => {
        await result.current.updateActivity();
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('update_session_activity', {
        p_session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      });
    });
  });

  describe('session cleanup', () => {
    it('cleans up the session on beforeunload', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');
      const { result } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });

      hoisted.rpcMock.mockClear();

      await act(async () => {
        window.dispatchEvent(new Event('beforeunload'));
        await Promise.resolve();
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('terminate_session', {
        p_session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      });
    });

    it('does not cleanup when currentSessionId is null', async () => {
      rpcResponses.upsert_user_session = { data: null, error: null };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');
      
      renderHook(() => useSessionManagement());

      hoisted.rpcMock.mockClear();

      await act(async () => {
        window.dispatchEvent(new Event('beforeunload'));
        await Promise.resolve();
      });

      expect(hoisted.rpcMock).not.toHaveBeenCalledWith('terminate_session', expect.anything());
    });
  });

  describe('fetchActiveSessions', () => {
    it('fetches active sessions for current user', async () => {
      const mockSessions = [
        { id: '11111111-1111-1111-1111-111111111111', user_id: '22222222-2222-2222-2222-222222222222', created_at: '2024-01-01', last_active_at: '2024-01-02', user_agent: 'Chrome', ip_address: null },
        { id: '33333333-3333-3333-3333-333333333333', user_id: '22222222-2222-2222-2222-222222222222', created_at: '2024-01-03', last_active_at: '2024-01-04', user_agent: 'Firefox', ip_address: null },
      ];
      rpcResponses.get_my_active_sessions = { data: mockSessions, error: null };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await act(async () => {
        await result.current.fetchActiveSessions();
      });

      await waitFor(() => {
        expect(result.current.activeSessions).toHaveLength(2);
        expect(result.current.activeSessions[0].id).toBe('11111111-1111-1111-1111-111111111111');
        expect(result.current.activeSessions[1].id).toBe('33333333-3333-3333-3333-333333333333');
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_active_sessions');
    });

    it('does not fetch when user is null', async () => {
      mockSessionReturn = { user: null, session: null };
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      hoisted.rpcMock.mockClear();

      await act(async () => {
        await result.current.fetchActiveSessions();
      });

      expect(hoisted.rpcMock).not.toHaveBeenCalledWith('get_my_active_sessions');
    });

    it('handles fetch error gracefully', async () => {
      rpcResponses.get_my_active_sessions = { data: null, error: { message: 'Fetch error' } };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await act(async () => {
        await result.current.fetchActiveSessions();
      });

      expect(result.current.activeSessions).toEqual([]);
    });
  });

  describe('terminateSession', () => {
    it('terminates a specific session and shows toast', async () => {
      const mockSessions = [
        { id: '11111111-1111-1111-1111-111111111111', user_id: '22222222-2222-2222-2222-222222222222', created_at: '2024-01-01', last_active_at: '2024-01-02', user_agent: 'Chrome', ip_address: null },
        { id: '33333333-3333-3333-3333-333333333333', user_id: '22222222-2222-2222-2222-222222222222', created_at: '2024-01-03', last_active_at: '2024-01-04', user_agent: 'Firefox', ip_address: null },
      ];
      rpcResponses.get_my_active_sessions = { data: mockSessions, error: null };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await act(async () => {
        await result.current.fetchActiveSessions();
      });

      await waitFor(() => {
        expect(result.current.activeSessions).toHaveLength(2);
      });

      await act(async () => {
        await result.current.terminateSession('11111111-1111-1111-1111-111111111111');
      });

      await waitFor(() => {
        expect(result.current.activeSessions).toHaveLength(1);
        expect(result.current.activeSessions[0].id).toBe('33333333-3333-3333-3333-333333333333');
      });

      expect(mockToast.success).toHaveBeenCalled();
    });

    it('handles termination error gracefully', async () => {
      rpcResponses.terminate_session = { data: null, error: { message: 'Delete error' } };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await act(async () => {
        await result.current.terminateSession('55555555-5555-5555-5555-555555555555');
      });

      expect(mockToast.success).not.toHaveBeenCalled();
    });
  });

  describe('terminateOtherSessions', () => {
    it('terminates other sessions and shows a toast', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');
      const { result } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });

      await act(async () => {
        await result.current.terminateOtherSessions();
      });

      expect(mockToast.success).toHaveBeenCalled();

      expect(hoisted.rpcMock).toHaveBeenCalledWith('terminate_all_other_sessions');
    });

    it('does not terminate when user is null', async () => {
      mockSessionReturn = { user: null, session: { access_token: 'token' } };
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      hoisted.rpcMock.mockClear();

      await act(async () => {
        await result.current.terminateOtherSessions();
      });

      expect(hoisted.rpcMock).not.toHaveBeenCalledWith('terminate_all_other_sessions');
    });

    it('does not terminate when currentSessionId is null', async () => {
      rpcResponses.upsert_user_session = { data: null, error: null };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      hoisted.rpcMock.mockClear();

      await act(async () => {
        await result.current.terminateOtherSessions();
      });

      expect(hoisted.rpcMock).not.toHaveBeenCalledWith('terminate_all_other_sessions');
    });

    it('filters activeSessions after terminating others', async () => {
      const mockSessions = [
        { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_id: '22222222-2222-2222-2222-222222222222', created_at: '2024-01-01', last_active_at: '2024-01-02', user_agent: 'Chrome', ip_address: null },
        { id: '33333333-3333-3333-3333-333333333333', user_id: '22222222-2222-2222-2222-222222222222', created_at: '2024-01-03', last_active_at: '2024-01-04', user_agent: 'Firefox', ip_address: null },
        { id: '44444444-4444-4444-4444-444444444444', user_id: '22222222-2222-2222-2222-222222222222', created_at: '2024-01-05', last_active_at: '2024-01-06', user_agent: 'Safari', ip_address: null },
      ];
      rpcResponses.get_my_active_sessions = { data: mockSessions, error: null };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });

      await act(async () => {
        await result.current.fetchActiveSessions();
      });

      await waitFor(() => {
        expect(result.current.activeSessions).toHaveLength(3);
      });

      await act(async () => {
        await result.current.terminateOtherSessions();
      });

      await waitFor(() => {
        expect(result.current.activeSessions).toHaveLength(1);
        expect(result.current.activeSessions[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });
    });

    it('handles termination error without updating state', async () => {
      rpcResponses.terminate_all_other_sessions = { data: null, error: { message: 'Delete error' } };
      hoisted.rpcMock.mockImplementation((fnName: string) => {
        const response = rpcResponses[fnName] || { data: null, error: null };
        return Promise.resolve(response);
      });
      
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });

      await act(async () => {
        await result.current.terminateOtherSessions();
      });

      expect(mockToast.success).not.toHaveBeenCalled();
    });
  });

  describe('config options', () => {
    it('accepts maxConcurrentSessions config', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement({ maxConcurrentSessions: 5 }));

      await waitFor(() => {
        expect(result.current).toBeDefined();
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });
    });

    it('accepts notifyOnNewSession config', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement({ notifyOnNewSession: false }));

      await waitFor(() => {
        expect(result.current).toBeDefined();
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });
    });

    it('uses default config when none provided', async () => {
      const { useSessionManagement } = await import('@/hooks/useSessionManagement');

      const { result } = renderHook(() => useSessionManagement());

      expect(result.current).toBeDefined();
      await waitFor(() => {
        expect(result.current.currentSessionId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      });
    });
  });
});
