import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import type { SubscriptionPackage } from '@/hooks/useMembership';

// Mock data - using valid UUIDs for Zod validation
const mockUser = { id: '550e8400-e29b-41d4-a716-446655440100', email: 'test@example.com' };

const mockSubscriptionPackage: SubscriptionPackage = {
  id: '550e8400-e29b-41d4-a716-446655440101',
  name: 'Premium Monthly',
  slug: 'premium-monthly',
  description: 'Premium monthly subscription',
  tier: 'upgraded',
  period: 'monthly',
  price: 999,
  currency: 'CZK',
  is_recurring: true,
  stripe_price_id: null,
  includes_products: null,
  includes_diagnostics: null,
  governance_tokens: 100,
  impact_tokens: 50,
  is_active: true,
  sort_order: 1,
};

// RPC response shape for get_my_subscriptions
const mockSubscriptionRpc = {
  id: '550e8400-e29b-41d4-a716-446655440102',
  user_id: '550e8400-e29b-41d4-a716-446655440100',
  package_id: '550e8400-e29b-41d4-a716-446655440101',
  amount_paid: 999,
  currency: 'CZK',
  status: 'pending',
  period_start: '2024-01-01T00:00:00Z',
  period_end: '2024-02-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
  package_name: 'Premium Monthly',
  package_tier: 'upgraded',
  package_period: 'monthly',
  tokens_governance: 100,
  tokens_impact: 50,
  tokens_data: 0,
};

// Mock toast (sonner)
const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(),
    loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
  })
);

vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'subscription.authRequired': 'Authentication Required',
        'subscription.authRequiredDesc': 'Please log in',
        'subscription.requested': 'Subscription Requested',
        'subscription.requestedDesc': `Package ${params?.name || ''} requested`,
        'subscription.requestFailed': 'Request Failed',
        'subscription.requestFailedDesc': 'Something went wrong',
      };
      return translations[key] || key;
    },
    i18n: { language: 'cs', changeLanguage: vi.fn() },
  }),
}));

// Hoisted mocks for Supabase RPC
const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

// Mock useSession
let mockAuthUser: { id: string; email: string } | null = mockUser;
vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    user: mockAuthUser,
    isLoading: false,
    hasRole: vi.fn(),
    roles: [],
    isAdmin: false,
    signOut: vi.fn(),
    error: null,
    refetchRoles: vi.fn(),
  }),
}));

// Import after mocks
import { useMySubscriptions, useSubscriptionPurchase } from '@/hooks/useSubscriptionPurchase';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Helper to setup RPC mock responses
const setupRpcMock = (responses: Record<string, { data: unknown; error: unknown }>) => {
  hoisted.rpcMock.mockImplementation((fnName: string) => {
    const response = responses[fnName];
    if (response) {
      return Promise.resolve(response);
    }
    return Promise.resolve({ data: null, error: null });
  });
};

/**
 * Whole calendar days between two instants.
 *
 * The period assertions below measure a CALENDAR interval (1 / 3 / 12 months) but
 * used to divide raw elapsed milliseconds by 24h. Across a DST change a calendar
 * quarter is 92 days AND ONE HOUR, so the quarterly bound (<= 92) failed on every
 * run whose "today + 3 months" crossed the autumn transition — on 2026-07-25 it
 * produced 92.0417 and blocked the push. Normalising both ends to UTC midnight of
 * their LOCAL calendar date measures what the test actually means and is stable on
 * every date and in every timezone.
 */
function calendarDaysBetween(start: Date, end: Date): number {
  const utcMidnight = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return (utcMidnight(end) - utcMidnight(start)) / (1000 * 60 * 60 * 24);
}

describe('useMySubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    mockAuthUser = mockUser;
  });

  it('should fetch user subscriptions', async () => {
    setupRpcMock({
      get_my_subscriptions: { data: [mockSubscriptionRpc], error: null },
    });

    const { result } = renderHook(() => useMySubscriptions(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].package?.name).toBe('Premium Monthly');
  });

  it('should return empty array when no user', async () => {
    mockAuthUser = null;
    setupRpcMock({
      get_my_subscriptions: { data: [], error: null },
    });

    const { result } = renderHook(() => useMySubscriptions(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Query should be disabled when no user - data can be undefined
    expect(result.current.data === undefined || result.current.data?.length === 0).toBe(true);
  });

  it('should call get_my_subscriptions RPC', async () => {
    setupRpcMock({
      get_my_subscriptions: { data: [], error: null },
    });

    renderHook(() => useMySubscriptions(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_subscriptions');
    });
  });
});

describe('useSubscriptionPurchase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    mockAuthUser = mockUser;
    mockToast.mockClear();
  });

  describe('requestPackage', () => {
    it('should show auth error when not logged in', async () => {
      mockAuthUser = null;

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.requestPackage(mockSubscriptionPackage);
      });

      expect(success).toBe(false);
      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should create pending subscription request', async () => {
      mockAuthUser = mockUser;
      setupRpcMock({
        create_subscription_request: { data: null, error: null },
      });

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.requestPackage(mockSubscriptionPackage);
      });

      expect(success).toBe(true);
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        'create_subscription_request',
        expect.objectContaining({
          p_package_id: '550e8400-e29b-41d4-a716-446655440101',
          p_amount_paid: 999,
          p_currency: 'CZK',
        })
      );
    });

    it('should calculate monthly period correctly', async () => {
      setupRpcMock({
        create_subscription_request: { data: null, error: null },
      });

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.requestPackage({ ...mockSubscriptionPackage, period: 'monthly' });
      });

      const rpcCall = hoisted.rpcMock.mock.calls.find(
        (call: unknown[]) => call[0] === 'create_subscription_request'
      ) as unknown[] | undefined;
      expect(rpcCall).toBeDefined();
      
      const params = rpcCall![1] as Record<string, string>;
      const periodStart = new Date(params.p_period_start);
      const periodEnd = new Date(params.p_period_end);
      
      // Should be approximately 1 month apart. calendarDaysBetween counts whole
      // calendar days, so a period crossing a DST boundary is exact rather than
      // off by the hour that Math.round of elapsed time would leave. Same helper
      // the annual case below uses.
      const diffDays = calendarDaysBetween(periodStart, periodEnd);
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it('should calculate quarterly period correctly', async () => {
      setupRpcMock({
        create_subscription_request: { data: null, error: null },
      });

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.requestPackage({ ...mockSubscriptionPackage, period: 'quarterly' });
      });

      const rpcCall = hoisted.rpcMock.mock.calls.find(
        (call: unknown[]) => call[0] === 'create_subscription_request'
      ) as unknown[] | undefined;
      expect(rpcCall).toBeDefined();
      
      const params = rpcCall![1] as Record<string, string>;
      const periodStart = new Date(params.p_period_start);
      const periodEnd = new Date(params.p_period_end);
      
      // Should be approximately 3 months apart (88-92 days depending on month).
      // calendarDaysBetween counts whole calendar days, so a quarter crossing a
      // DST boundary is exact — the raw elapsed fraction made this fail when the
      // test ran ~3 months before the clock change (caught live 2026-07-25).
      const diffDays = calendarDaysBetween(periodStart, periodEnd);
      expect(diffDays).toBeGreaterThanOrEqual(88);
      expect(diffDays).toBeLessThanOrEqual(92);
    });

    it('should calculate annual period correctly', async () => {
      setupRpcMock({
        create_subscription_request: { data: null, error: null },
      });

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.requestPackage({ ...mockSubscriptionPackage, period: 'annual' });
      });

      const rpcCall = hoisted.rpcMock.mock.calls.find(
        (call: unknown[]) => call[0] === 'create_subscription_request'
      ) as unknown[] | undefined;
      expect(rpcCall).toBeDefined();
      
      const params = rpcCall![1] as Record<string, string>;
      const periodStart = new Date(params.p_period_start);
      const periodEnd = new Date(params.p_period_end);
      
      // Should be approximately 1 year apart
      const diffDays = calendarDaysBetween(periodStart, periodEnd);
      expect(Math.round(diffDays)).toBeGreaterThanOrEqual(365);
      expect(Math.round(diffDays)).toBeLessThanOrEqual(366);
    });

    it('should show success toast on successful request', async () => {
      setupRpcMock({
        create_subscription_request: { data: null, error: null },
      });

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.requestPackage(mockSubscriptionPackage);
      });

      expect(mockToast.success).toHaveBeenCalled();
    });

    it('should show error toast on database error', async () => {
      setupRpcMock({
        create_subscription_request: { data: null, error: { message: 'Database error' } },
      });

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.requestPackage(mockSubscriptionPackage);
      });

      expect(success).toBe(false);
      expect(mockToast.error).toHaveBeenCalled();
    });

    it('should set loading state during request', async () => {
      let resolveRpc: (value: { data: null; error: null }) => void;
      hoisted.rpcMock.mockImplementation(() => new Promise(resolve => { resolveRpc = resolve; }));

      const { result } = renderHook(() => useSubscriptionPurchase(), { wrapper: createWrapper() });

      expect(result.current.loading).toBe(false);

      const requestPromise = act(async () => {
        result.current.requestPackage(mockSubscriptionPackage);
      });

      // Resolve the RPC
      resolveRpc!({ data: null, error: null });
      await requestPromise;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });
});
