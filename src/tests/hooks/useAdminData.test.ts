import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAllRegistrations, useAggregateTrackingData, useMembersSummary } from '@/hooks/useAdminData';

const mockData = vi.hoisted(() => ({ data: [], error: null }));
const mockRpc = vi.hoisted(() => vi.fn().mockResolvedValue(mockData));
const mockLimit = vi.hoisted(() => vi.fn().mockResolvedValue(mockData));
const mockOrder = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ order: mockOrder })));
const mockEq = vi.hoisted(() => vi.fn().mockResolvedValue(mockData));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ eq: mockEq })));
const mockFrom = vi.hoisted(
  () =>
    vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    }))
);

const mockHasRole = vi.hoisted(() => vi.fn((role: string) => role === 'staff' || role === 'admin'));
const mockHasAnyPermission = vi.hoisted(() => vi.fn(() => true));
const mockHasPermission = vi.hoisted(() =>
  vi.fn((p: string) => ['view_admin_dashboard', 'view_staff_dashboard'].includes(p))
);

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => ({
    user: { id: 'test-admin-id' },
    session: { user: { id: 'test-admin-id' } },
    isLoading: false,
    hasRole: mockHasRole,
    roles: ['admin'],
    isAdmin: true,
    signOut: vi.fn(),
  })),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(() => ({
    permissions: ['view_admin_dashboard', 'view_staff_dashboard'],
    isLoading: false,
    hasPermission: mockHasPermission,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: mockHasAnyPermission,
  })),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

describe('useAllRegistrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasAnyPermission.mockImplementation(() => true);
  });

  it('should initialize with loading state', async () => {
    const { result } = renderHook(() => useAllRegistrations());
    
    expect(result.current.loading).toBe(true);
    expect(result.current.registrations).toEqual([]);

    // Allow initial effects to settle to avoid act warnings.
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should eventually set loading to false', async () => {
    const { result } = renderHook(() => useAllRegistrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should return empty when not staff', async () => {
    mockHasAnyPermission.mockImplementation(() => false);

    const { result } = renderHook(() => useAllRegistrations());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.registrations).toEqual([]);
    expect(result.current.error).toBe(null);
  });
});

describe('useAggregateTrackingData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasAnyPermission.mockImplementation(() => true);
    mockHasPermission.mockImplementation((p: string) => ['view_admin_dashboard', 'view_staff_dashboard'].includes(p));
  });

  it('should initialize correctly', async () => {
    const { result } = renderHook(() => useAggregateTrackingData());

    // Let initial effects settle to avoid act warnings.
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
  });

  it('should eventually set loading to false', async () => {
    const { result } = renderHook(() => useAggregateTrackingData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should return null when not staff', async () => {
    // Fail-closed: without admin dashboard permission, hook should not fetch and should keep data null.
    mockHasPermission.mockImplementation(() => false);

    const { result } = renderHook(() => useAggregateTrackingData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe(null);
  });
});

describe('useMembersSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasAnyPermission.mockImplementation(() => true);
  });

  it('should initialize with loading state', async () => {
    const { result } = renderHook(() => useMembersSummary());
    
    expect(result.current.members).toEqual([]);

    // Allow initial effects to settle to avoid act warnings.
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should eventually set loading to false', async () => {
    const { result } = renderHook(() => useMembersSummary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should return empty when not staff', async () => {
    mockHasAnyPermission.mockImplementation(() => false);

    const { result } = renderHook(() => useMembersSummary());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.members).toEqual([]);
  });
});
