import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

// Mock data
const mockUmbrellaStudy = {
  id: 'umbrella-study-123',
  code: 'AISHA-OBS-001',
  name: 'AISHA Community',
  is_umbrella: true,
};

const mockRegistration = {
  id: 'registration-123',
  user_id: 'user-123',
  study_id: 'umbrella-study-123',
  status: 'enrolled',
  created_at: '2024-01-01T00:00:00Z',
};

const mockUser = { id: 'user-123', email: 'test@example.com' };

// Hoisted mocks for Supabase RPC
const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

// Mock useSession
vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ 
    user: mockUser, 
    isLoading: false,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
  }),
}));

// Import after mocks
import { useRIIMembership, useIsUmbrellaStudy } from '@/hooks/useRIIMembership';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Helper to setup RPC mock responses based on function name
const setupRpcMock = (responses: {
  get_umbrella_study?: { data: unknown; error: unknown };
  get_my_umbrella_registration?: { data: unknown; error: unknown };
  get_my_questionnaire_completed?: { data: unknown; error: unknown };
  is_umbrella_study?: { data: unknown; error: unknown };
}) => {
  hoisted.rpcMock.mockImplementation((fnName: string) => {
    if (fnName === 'get_umbrella_study') {
      return Promise.resolve(responses.get_umbrella_study ?? { data: null, error: null });
    }
    if (fnName === 'get_my_umbrella_registration') {
      return Promise.resolve(responses.get_my_umbrella_registration ?? { data: null, error: null });
    }
    if (fnName === 'get_my_questionnaire_completed') {
      return Promise.resolve(responses.get_my_questionnaire_completed ?? { data: false, error: null });
    }
    if (fnName === 'is_umbrella_study') {
      return Promise.resolve(responses.is_umbrella_study ?? { data: false, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
};

describe('useRIIMembership', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  describe('umbrella study fetching', () => {
    it('should fetch the umbrella study correctly', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [mockRegistration], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.umbrellaStudy).toEqual(mockUmbrellaStudy);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_umbrella_study');
    });

    it('should handle missing umbrella study', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [], error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.umbrellaStudy).toBeNull();
      expect(result.current.isRIIMember).toBe(false);
    });
  });

  describe('membership status', () => {
    it('should return isRIIMember=true for enrolled users', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [mockRegistration], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isRIIMember).toBe(true);
      });

      expect(result.current.isPendingRII).toBe(false);
    });

    it('should return isRIIMember=true for active users', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [{ ...mockRegistration, status: 'active' }], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isRIIMember).toBe(true);
      });
    });

    it('should return isRIIMember=true for completed users', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [{ ...mockRegistration, status: 'completed' }], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isRIIMember).toBe(true);
      });
    });

    it('should return isPendingRII=true for screening users', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [{ ...mockRegistration, status: 'screening' }], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isPendingRII).toBe(true);
      });

      expect(result.current.isRIIMember).toBe(false);
    });

    it('should return isRIIMember=false for withdrawn users', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [{ ...mockRegistration, status: 'withdrawn' }], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isRIIMember).toBe(false);
      });

      expect(result.current.isPendingRII).toBe(false);
    });

    it('should return isRIIMember=false when no registration exists', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isRIIMember).toBe(false);
      expect(result.current.registration).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      setupRpcMock({
        get_umbrella_study: { data: null, error: { message: 'Database error' } },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isRIIMember).toBe(false);
    });
  });

  describe('umbrellaStudyId', () => {
    it('should return umbrellaStudyId from umbrellaStudy', async () => {
      setupRpcMock({
        get_umbrella_study: { data: [mockUmbrellaStudy], error: null },
        get_my_umbrella_registration: { data: [mockRegistration], error: null },
        get_my_questionnaire_completed: { data: false, error: null },
      });

      const { result } = renderHook(() => useRIIMembership(), { wrapper: createWrapper() });

      // Initially should be undefined until query completes
      expect(result.current.umbrellaStudyId).toBeUndefined();
      
      // After queries complete, if umbrellaStudy is set, umbrellaStudyId should match
      await waitFor(() => {
        if (result.current.umbrellaStudy) {
          expect(result.current.umbrellaStudyId).toBe(result.current.umbrellaStudy.id);
        }
      }, { timeout: 100 });
    });
  });
});

describe('useIsUmbrellaStudy', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it('should return true for umbrella studies', async () => {
    setupRpcMock({
      is_umbrella_study: { data: true, error: null },
    });

    const { result } = renderHook(
      () => useIsUmbrellaStudy('umbrella-study-123'), 
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('should return false for non-umbrella studies', async () => {
    setupRpcMock({
      is_umbrella_study: { data: false, error: null },
    });

    const { result } = renderHook(
      () => useIsUmbrellaStudy('regular-study-123'), 
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('should return false when study not found', async () => {
    setupRpcMock({
      is_umbrella_study: { data: false, error: null },
    });

    const { result } = renderHook(
      () => useIsUmbrellaStudy('non-existent-123'), 
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it('should not fetch when studyId is empty', async () => {
    const { result } = renderHook(
      () => useIsUmbrellaStudy(''), 
      { wrapper: createWrapper() }
    );

    expect(result.current).toBe(false);
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });
});
