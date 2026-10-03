import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTokens } from '@/hooks/useTokens';

const mockUser = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'test@example.com',
};

let mockAuthReturn: {
  user: typeof mockUser | null;
  isLoading: boolean;
  hasRole: ReturnType<typeof vi.fn>;
  roles: unknown[];
  isAdmin: boolean;
  signOut: ReturnType<typeof vi.fn>;
  refetchRoles: ReturnType<typeof vi.fn>;
  session?: null;
} = {
  user: mockUser,
  isLoading: false,
  hasRole: vi.fn(),
  roles: [],
  isAdmin: false,
  signOut: vi.fn(),
  refetchRoles: vi.fn(),
};

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => mockAuthReturn),
}));

const mockMembership = {
  tokens_governance: 100,
  tokens_impact: 50,
  tokens_data: 25,
};

vi.mock('@/hooks/useMembership', () => ({
  useMembership: vi.fn(() => ({
    membership: mockMembership,
    loading: false,
  })),
}));

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockRpcFn = vi.fn();

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: vi.fn(() => ({
      select: (...args: unknown[]) => mockSelect(...args),
    })),
    rpc: (...args: unknown[]) => mockRpcFn(...args),
  },
}));

describe('useTokens', () => {
  const mockTransactions = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      user_id: '22222222-2222-2222-2222-222222222222',
      token_type: 'governance' as const,
      amount: 10,
      transaction_type: 'earned' as const,
      description: 'Study participation',
      reference_id: '33333333-3333-3333-3333-333333333333',
      reference_type: 'study',
      balance_after: 100,
      created_at: '2024-03-15T08:00:00Z',
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      user_id: '22222222-2222-2222-2222-222222222222',
      token_type: 'impact' as const,
      amount: -5,
      transaction_type: 'spent' as const,
      description: 'Voted on proposal',
      reference_id: '55555555-5555-5555-5555-555555555555',
      reference_type: 'vote',
      balance_after: 45,
      created_at: '2024-03-14T08:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthReturn = {
      user: mockUser,
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn(),
      refetchRoles: vi.fn(),
    };

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue({ data: mockTransactions, error: null });
    mockRpcFn.mockResolvedValue({ error: null });
  });

  it('should fetch token transactions successfully', async () => {
    mockRpcFn.mockImplementation((rpcName: string) => {
      if (rpcName === 'get_my_token_transactions') {
        return Promise.resolve({ data: mockTransactions, error: null });
      }
      return Promise.resolve({ error: null });
    });

    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.transactions).toHaveLength(2);
  });

  it('should calculate correct token balances', async () => {
    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.balance.governance).toBe(100);
    expect(result.current.balance.impact).toBe(50);
    expect(result.current.balance.data).toBe(25);
    expect(result.current.totalTokens).toBe(175);
  });

  it('should handle empty transactions', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.transactions).toEqual([]);
    expect(result.current.balance.governance).toBe(100);
  });

  it('should log transaction successfully via RPC', async () => {
    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let logResult;
    await act(async () => {
      logResult = await result.current.logTransaction(
        'governance',
        10,
        'earned',
        'Study participation',
        'study-001',
        'study'
      );
    });

    expect(logResult!.error).toBeNull();
    expect(mockRpcFn).toHaveBeenCalledWith('create_token_transaction', {
      p_token_type: 'governance',
      p_amount: 10,
      p_transaction_type: 'earned',
      p_description: 'Study participation',
      p_reference_id: 'study-001',
    });
  });

  it('should handle spent tokens with negative amount via RPC', async () => {
    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.logTransaction(
        'impact',
        5,
        'spent',
        'Voted on proposal'
      );
    });

    expect(mockRpcFn).toHaveBeenCalledWith('create_token_transaction', {
      p_token_type: 'impact',
      p_amount: -5,
      p_transaction_type: 'spent',
      p_reference_id: undefined,
      p_description: 'Voted on proposal',
    });
  });

  it('should handle earned tokens with positive amount via RPC', async () => {
    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.logTransaction(
        'governance',
        20,
        'earned',
        'Completed survey'
      );
    });

    expect(mockRpcFn).toHaveBeenCalledWith('create_token_transaction', {
      p_token_type: 'governance',
      p_amount: 20,
      p_transaction_type: 'earned',
      p_reference_id: undefined,
      p_description: 'Completed survey',
    });
  });

  it('should return error when not authenticated', async () => {
    mockAuthReturn = {
      user: null,
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn(),
      refetchRoles: vi.fn(),
    };

    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const logResult = await result.current.logTransaction(
      'governance',
      10,
      'earned'
    );

    expect(logResult.error).toBeDefined();
    expect(logResult.error?.message).toBe('Not authenticated');
  });

  it('should return empty when user is null', async () => {
    mockAuthReturn = {
      user: null,
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn(),
      refetchRoles: vi.fn(),
    };

    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.transactions).toEqual([]);
  });

  it('should handle fetch error', async () => {
    mockLimit.mockResolvedValue({ data: null, error: new Error('Database error') });

    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.transactions).toEqual([]);
  });

  it('should handle RPC error', async () => {
    mockRpcFn.mockResolvedValue({ error: new Error('RPC failed') });

    const { result } = renderHook(() => useTokens());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const logResult = await act(async () => {
      return await result.current.logTransaction(
        'governance',
        10,
        'earned'
      );
    });

    expect(logResult.error).toBeDefined();
  });
});
