import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMembership, useSubscriptionPackages } from '@/hooks/useMembership';
import i18n from '@/i18n';

// Mock user
const mockUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'test@example.com',
};

const mockUseSession = vi.fn();

vi.mock('@/hooks/useSession', () => ({
  useSession: () => mockUseSession(),
}));

// Mock Supabase - define mocks in hoisted block to avoid initialization issues
const mockSupabaseFunctions = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  single: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: vi.fn(() => ({
      select: mockSupabaseFunctions.select,
      insert: mockSupabaseFunctions.insert,
      update: mockSupabaseFunctions.update,
    })),
    rpc: vi.fn((...args) => mockSupabaseFunctions.rpc(...args)),
  },
}));

const mockSelect = mockSupabaseFunctions.select;
const mockEq = mockSupabaseFunctions.eq;
const mockMaybeSingle = mockSupabaseFunctions.maybeSingle;
const mockInsert = mockSupabaseFunctions.insert;
const mockUpdate = mockSupabaseFunctions.update;
const mockSingle = mockSupabaseFunctions.single;
const mockRpc = mockSupabaseFunctions.rpc;

describe('useMembership', () => {
  const mockMembership = {
    id: '00000000-0000-0000-0000-000000000101',
    user_id: '00000000-0000-0000-0000-000000000001',
    tier: 'basic' as const,
    status: 'active' as const,
    payment_type: 'one_time' as const,
    subscription_period: 'monthly' as const,
    stripe_subscription_id: null,
    stripe_customer_id: null,
    starts_at: '2024-01-01T00:00:00Z',
    expires_at: '2025-01-01T00:00:00Z',
    auto_renew: false,
    tokens_aisha: 0,
    tokens_governance: 100,
    tokens_impact: 50,
    tokens_data: 25,
    notes: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      user: mockUser,
      session: { user: mockUser },
      isLoading: false,
    });
    
    // Default: RPC returns membership
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        return Promise.resolve({ data: [mockMembership], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });
    
    // Legacy fallback chain
    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      maybeSingle: mockMaybeSingle,
    });
  });

  it('should return loading true initially', async () => {
    const { result } = renderHook(() => useMembership());
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should fetch membership successfully', async () => {
    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.membership).toEqual(mockMembership);
    expect(result.current.hasMembership).toBe(true);
    expect(result.current.isActive).toBe(true);
    expect(result.current.isUpgraded).toBe(false);
  });

  it('should identify upgraded membership', async () => {
    const upgradedMembership = {
      ...mockMembership,
      tier: 'upgraded' as const,
    };
    
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        return Promise.resolve({ data: [upgradedMembership], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isUpgraded).toBe(true);
  });

  it('should identify inactive membership', async () => {
    const expiredMembership = {
      ...mockMembership,
      status: 'expired' as const,
    };
    
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        return Promise.resolve({ data: [expiredMembership], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isActive).toBe(false);
  });

  it('should handle no membership', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.membership).toBe(null);
    expect(result.current.hasMembership).toBe(false);
    expect(result.current.isActive).toBe(false);
  });

  it('should create new membership', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        return Promise.resolve({ data: [], error: null });
      }
      if (fnName === 'create_membership') {
        return Promise.resolve({ data: [mockMembership], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let createResult: Awaited<ReturnType<(typeof result.current.createMembership)>> | undefined;
    await act(async () => {
      createResult = await result.current.createMembership('basic');
    });

    expect(createResult!.data).toEqual(mockMembership);
    expect(createResult!.error).toBe(null);

    await waitFor(() => {
      expect(result.current.membership).toEqual(mockMembership);
    });
  });

  it('should update existing membership', async () => {
    const updatedMembership = {
      ...mockMembership,
      tier: 'upgraded' as const,
    };

    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        return Promise.resolve({ data: [mockMembership], error: null });
      }
      if (fnName === 'update_my_membership') {
        return Promise.resolve({ data: [updatedMembership], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let updateResult: Awaited<ReturnType<(typeof result.current.updateMembership)>> | undefined;
    await act(async () => {
      updateResult = await result.current.updateMembership({
        tier: 'upgraded',
      });
    });

    expect(updateResult!.error).toBe(null);

    await waitFor(() => {
      expect(result.current.membership?.tier).toBe('upgraded');
    });
  });

  it('should handle fetch error', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        return Promise.resolve({ data: null, error: new Error('Database error') });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(i18n.t('errors.genericError'));
  });

  it('should provide refetch function', async () => {
    let callCount = 0;
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_membership') {
        callCount++;
        return Promise.resolve({ data: [mockMembership], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch();
    });

    // Should have called RPC twice (initial + refetch)
    expect(callCount).toBe(2);
  });
});

describe('useSubscriptionPackages', () => {
  const mockPackages = [
    {
      id: '00000000-0000-0000-0000-000000000201',
      name: 'Basic Monthly',
      slug: 'basic-monthly',
      description: 'Basic membership',
      tier: 'basic' as const,
      period: 'monthly' as const,
      price: 999,
      currency: 'CZK',
      is_recurring: true,
      stripe_price_id: 'price_basic_monthly',
      includes_products: ['retisin'],
      includes_diagnostics: null,
      governance_tokens: 10,
      impact_tokens: 5,
      is_active: true,
      sort_order: 1,
    },
    {
      id: '00000000-0000-0000-0000-000000000202',
      name: 'Upgraded Quarterly',
      slug: 'upgraded-quarterly',
      description: 'Premium membership',
      tier: 'upgraded' as const,
      period: 'quarterly' as const,
      price: 2499,
      currency: 'CZK',
      is_recurring: true,
      stripe_price_id: 'price_upgraded_quarterly',
      includes_products: ['retisin', 'lyastin'],
      includes_diagnostics: ['blood_panel'],
      governance_tokens: 50,
      impact_tokens: 25,
      is_active: true,
      sort_order: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_subscription_packages') {
        return Promise.resolve({ data: mockPackages, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });
  });

  it('should fetch subscription packages', async () => {
    const { result } = renderHook(() => useSubscriptionPackages());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.packages).toEqual(mockPackages);
    expect(result.current.error).toBe(null);
  });

  it('should handle empty packages', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_subscription_packages') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useSubscriptionPackages());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.packages).toEqual([]);
  });

  it('should handle fetch error', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_subscription_packages') {
        return Promise.resolve({ data: null, error: new Error('Failed to load packages') });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useSubscriptionPackages());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(i18n.t('errors.genericError'));
  });
});

describe('useMembership without user', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock useSession to return no user
    mockUseSession.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
    });

    // RPC should not be called when user is null
    mockRpc.mockImplementation(() => {
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });
  });

  it('should return null membership when user is null', async () => {
    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.membership).toBe(null);
    expect(result.current.hasMembership).toBe(false);
  });

  it('should return error when creating membership without user', async () => {
    const { result } = renderHook(() => useMembership());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let createResult: Awaited<ReturnType<(typeof result.current.createMembership)>> | undefined;
    await act(async () => {
      createResult = await result.current.createMembership('basic');
    });

    expect(createResult!.error).toBe('Not authenticated');
  });
});
