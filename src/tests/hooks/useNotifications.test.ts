import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useNotifications } from '@/hooks/useNotifications';

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
};

let mockSessionReturn: {
  user: { id: string; email: string } | null;
  isLoading: boolean;
  hasRole: ReturnType<typeof vi.fn>;
  roles: string[];
  isAdmin: boolean;
  signOut: ReturnType<typeof vi.fn>;
} = {
  user: mockUser,
  isLoading: false,
  hasRole: vi.fn(),
  roles: [],
  isAdmin: false,
  signOut: vi.fn(),
};

vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => mockSessionReturn),
}));

// Mock Supabase - define mocks in hoisted block to avoid initialization issues
const mockSupabaseFunctions = {
  rpc: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
};

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    from: vi.fn(() => ({
      select: vi.fn(),
      update: vi.fn(),
    })),
    rpc: vi.fn((...args) => mockSupabaseFunctions.rpc(...args)),
    channel: vi.fn(() => ({ on: mockSupabaseFunctions.on })),
    removeChannel: vi.fn(),
  },
}));

const mockRpc = mockSupabaseFunctions.rpc;
const mockOn = mockSupabaseFunctions.on;
const mockSubscribe = mockSupabaseFunctions.subscribe;

describe('useNotifications', () => {
  const mockNotifications = [
    {
      id: '550e8400-e29b-41d4-a716-446655440301',
      user_id: '550e8400-e29b-41d4-a716-446655440300',
      type: 'info',
      title: 'New Study Available',
      message: 'Check out the new research study',
      link: '/studies/new-study',
      is_read: false,
      created_at: '2024-03-15T08:00:00Z',
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440302',
      user_id: '550e8400-e29b-41d4-a716-446655440300',
      type: 'reminder',
      title: 'Health Check-in Reminder',
      message: 'Complete your daily check-in',
      link: '/member/checkin',
      is_read: true,
      created_at: '2024-03-14T08:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionReturn = {
      user: mockUser,
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn(),
    };

    // Default: RPC returns notifications
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_notifications') {
        return Promise.resolve({ data: mockNotifications, error: null });
      }
      if (fnName === 'get_unread_notification_count') {
        return Promise.resolve({ data: 1, error: null });
      }
      if (fnName === 'mark_notification_read') {
        return Promise.resolve({ data: null, error: null });
      }
      if (fnName === 'mark_all_notifications_read') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });
    
    // Mock channel subscription
    mockOn.mockReturnValue({ on: mockOn, subscribe: mockSubscribe });
    mockSubscribe.mockReturnValue({});
  });

  it('should fetch notifications successfully', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(1);
  });

  it('should handle empty notifications', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_notifications') {
        return Promise.resolve({ data: [], error: null });
      }
      if (fnName === 'get_unread_notification_count') {
        return Promise.resolve({ data: 0, error: null });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('should mark notification as read', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead('notif-001');
    });

    expect(mockRpc).toHaveBeenCalledWith('mark_notification_read', { p_notification_id: 'notif-001' });
  });

  it('should mark all notifications as read', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAllAsRead();
    });

    expect(mockRpc).toHaveBeenCalledWith('mark_all_notifications_read');
  });

  it('should return empty when user is null', async () => {
    mockSessionReturn = {
      user: null,
      isLoading: false,
      hasRole: vi.fn(),
      roles: [],
      isAdmin: false,
      signOut: vi.fn(),
    };

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('should handle fetch error', async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_my_notifications') {
        return Promise.resolve({ data: null, error: new Error('Database error') });
      }
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toEqual([]);
  });

  it('should not update state after unmount when fetch resolves late', async () => {
    type ResolveType = (value: { data: unknown; error: unknown }) => void;
    let resolveRpc: ResolveType | null = null;
    const rpcPromise = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      resolveRpc = resolve;
    });

    mockRpc.mockImplementationOnce(() => rpcPromise);

    const { unmount } = renderHook(() => useNotifications());
    unmount();

    (resolveRpc as unknown as ResolveType)({ data: mockNotifications, error: null });
    await rpcPromise;
  });
});
