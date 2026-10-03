import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, act } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/utils/test-utils';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  useSessionMock: vi.fn(() => ({ user: null as { id: string } | null })),
  usePermissionsMock: vi.fn(() => ({
    hasPermission: (permission: string) => permission === 'view_partner_dashboard',
    isLoading: false,
  })),
}));

// Chainable mock for .from() queries
const createChainableMock = (data: unknown, error: unknown = null) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  single: vi.fn().mockResolvedValue({ data, error }),
});

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
    from: (...args: unknown[]) => hoisted.fromMock(...args),
  },
}));

// Mock both paths since hook uses relative import "./useSession"
vi.mock('@/hooks/useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));
vi.mock('./useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));

// Mock both paths since hook uses relative import "./usePermissions"
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => hoisted.usePermissionsMock(),
}));
vi.mock('./usePermissions', () => ({
  usePermissions: () => hoisted.usePermissionsMock(),
}));

import { useConsultantStudies, useUserAlerts, useRecentUserData } from '@/hooks/usePartnerDashboard';

describe('usePartnerDashboard hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    hoisted.fromMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ user: null }); // Default to no user
    hoisted.usePermissionsMock.mockReset();
    hoisted.usePermissionsMock.mockReturnValue({
      hasPermission: (permission: string) => permission === 'view_partner_dashboard',
      isLoading: false,
    });
    
    // Default fromMock to return null (no partner profile)
    hoisted.fromMock.mockReturnValue(createChainableMock(null));
  });

  describe('useConsultantStudies', () => {
    it('pro disabled query (bez user) vrací [] po refetch a nedotýká se DB', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useConsultantStudies());

      const refetched = await act(async () => result.current.refetch());
      expect(refetched.data).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('když RPC vrátí prázdný seznam, vrací []', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_consultant_studies') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useConsultantStudies());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('mapuje RPC response na ConsultantStudy interface', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_consultant_studies') {
          return Promise.resolve({
            data: [
              {
                id: 'c1',
                study_id: 's1',
                partner_id: 'p1',
                status: 'approved',
                applied_at: '2025-01-01',
                approved_at: '2025-01-02',
                study_name: 'Study A',
                study_code: 'A',
                study_status: 'active',
                registration_count: 5,
              },
              {
                id: 'c2',
                study_id: 's2',
                partner_id: 'p1',
                status: 'pending',
                applied_at: '2025-01-03',
                approved_at: null,
                study_name: 'Study B',
                study_code: 'B',
                study_status: 'active',
                registration_count: 0,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useConsultantStudies());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([
        expect.objectContaining({ id: 'c1', assigned_users: 5, study_name: 'Study A', study_code: 'A', status: 'approved' }),
        expect.objectContaining({ id: 'c2', assigned_users: 0, study_name: 'Study B', status: 'pending' }),
      ]);
    });

    it('graceful fallback když RPC neexistuje (42883)', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_consultant_studies') {
          return Promise.resolve({ data: null, error: { code: '42883', message: 'Function not found' } });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useConsultantStudies());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('graceful fallback když RPC neexistuje (PGRST202)', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_consultant_studies') {
          return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useConsultantStudies());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('jiný RPC error způsobí selhání query', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_consultant_studies') {
          return Promise.resolve({ data: null, error: { code: 'INTERNAL', message: 'Database error' } });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useConsultantStudies());
      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useUserAlerts', () => {
    it('returns empty array when RPC returns empty list', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_my_partner_profile') {
          return Promise.resolve({ data: { id: 'partner-1' }, error: null });
        }
        if (fnName === 'get_partner_user_alerts') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      
      const { result } = renderHookWithProviders(() => useUserAlerts());
      await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
      expect(result.current.data).toEqual([]);
    });

    it('mapuje RPC response na UserAlert interface', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string, args?: Record<string, unknown>) => {
        if (fnName === 'get_my_partner_profile') {
          return Promise.resolve({ data: { id: 'partner-1' }, error: null });
        }
        if (fnName === 'get_partner_user_alerts') {
          expect(args).toEqual({ p_partner_id: 'partner-1' });
          return Promise.resolve({
            data: [
              { id: 'a1', user_id: 'm1', user_name: 'User 1', alert_type: 'new_lab_result', message: 'New lab results', created_at: '2025-01-03T10:00:00Z', study_name: 'Study A' },
              { id: 'a2', user_id: 'm1', user_name: 'User 1', alert_type: 'new_checkin', message: 'New check-in', created_at: '2025-01-02T10:00:00Z', study_name: 'Study A' },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useUserAlerts());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.[0]).toEqual(
        expect.objectContaining({ id: 'a1', type: 'new_lab_result', study_name: 'Study A' })
      );
      expect(result.current.data?.[1]).toEqual(
        expect.objectContaining({ id: 'a2', type: 'new_checkin', study_name: 'Study A' })
      );
    });

    it('když RPC vrátí error, query failne', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_my_partner_profile') {
          return Promise.resolve({ data: { id: 'partner-1' }, error: null });
        }
        if (fnName === 'get_partner_user_alerts') {
          return Promise.resolve({ data: null, error: { code: 'INTERNAL', message: 'Database error' } });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useUserAlerts());
      await waitFor(() => expect(result.current.isError).toBe(true));
    });

    it('pro disabled query (bez user) vrací [] po refetch', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useUserAlerts());

      const refetched = await act(async () => result.current.refetch());
      expect(refetched.data).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });
  });

  describe('useRecentUserData', () => {
    it('pro disabled query (bez user) vrací [] po refetch', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useRecentUserData());

      const refetched = await act(async () => result.current.refetch());
      expect(refetched.data).toEqual([]);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('když RPC vrátí prázdný seznam, vrací []', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_partner_recent_user_data') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useRecentUserData());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('mapuje RPC response na RecentUserData interface', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_my_partner_profile') {
          return Promise.resolve({ data: { id: 'partner-1' }, error: null });
        }
        if (fnName === 'get_partner_recent_user_data') {
          return Promise.resolve({
            data: [
              { user_id: 'm1', user_name: 'User 1', study_name: 'Study A', last_check_in: '2025-01-10T10:00:00Z', last_lab_result: '2025-01-11T10:00:00Z', registration_status: 'active' },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useRecentUserData());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([
        expect.objectContaining({
          user_id: 'm1',
          user_name: 'User 1',
          study_name: 'Study A',
          last_check_in: '2025-01-10T10:00:00Z',
          last_lab_result: '2025-01-11T10:00:00Z',
          registration_status: 'active',
        }),
      ]);
    });

    it('když RPC vrátí error, query failne', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_my_partner_profile') {
          return Promise.resolve({ data: { id: 'partner-1' }, error: null });
        }
        if (fnName === 'get_partner_recent_user_data') {
          return Promise.resolve({ data: null, error: { code: 'INTERNAL', message: 'Database error' } });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useRecentUserData());
      await waitFor(() => expect(result.current.isError).toBe(true));
    });

    it('vrací prázdný seznam pokud RPC vrátí null data', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: { id: 'u1' } });

      hoisted.rpcMock.mockImplementation((fnName: string) => {
        if (fnName === 'get_partner_recent_user_data') {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { result } = renderHookWithProviders(() => useRecentUserData());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });
});
