import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Hoisted mocks
const mockRpc = vi.hoisted(() => vi.fn());
const mockUseAuth = vi.hoisted(() => vi.fn());

// Mock Supabase with hoisted rpc mock
vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

// Mock useAuth with hoisted mock
vi.mock('@/hooks/useAuth', () => ({
  useAuth: mockUseAuth,
}));

// Import after mocks are set up
import { useUserRole } from '@/hooks/useUserRole';

// Mock user data
const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
};

// Mock role data
const mockAdminRole = {
  id: 'role-001',
  user_id: 'test-user-id',
  role: 'admin' as const,
  granted_by: null,
  granted_at: '2024-01-01T00:00:00Z',
};

const mockStaffRole = {
  id: 'role-002',
  user_id: 'test-user-id',
  role: 'staff' as const,
  granted_by: 'admin-id',
  granted_at: '2024-01-01T00:00:00Z',
};

const mockMemberRole = {
  id: 'role-003',
  user_id: 'test-user-id',
  role: 'member' as const,
  granted_by: null,
  granted_at: '2024-01-01T00:00:00Z',
};

const mockPractitionerRole = {
  id: 'role-004',
  user_id: 'test-user-id',
  role: 'practitioner' as const,
  granted_by: 'admin-id',
  granted_at: '2024-01-01T00:00:00Z',
};

describe('useUserRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default: authenticated user
    mockUseAuth.mockReturnValue({
      user: mockUser,
      loading: false,
      isAuthenticated: true,
      session: { user: mockUser },
      signOut: vi.fn(),
    });
  });

  it('should return loading true initially', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    
    const { result } = renderHook(() => useUserRole());
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should identify admin user correctly', async () => {
    mockRpc.mockResolvedValue({ data: [mockAdminRole], error: null });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isStaff).toBe(true); // Admin includes staff
    expect(result.current.isPractitioner).toBe(true); // Admin includes practitioner
    expect(result.current.hasRole('admin')).toBe(true);
  });

  it('should identify staff user correctly', async () => {
    mockRpc.mockResolvedValue({ data: [mockStaffRole], error: null });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStaff).toBe(true);
    expect(result.current.isPractitioner).toBe(true); // Staff includes practitioner
    expect(result.current.hasRole('staff')).toBe(true);
    expect(result.current.hasRole('admin')).toBe(false);
  });

  it('should identify practitioner user correctly', async () => {
    mockRpc.mockResolvedValue({ data: [mockPractitionerRole], error: null });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStaff).toBe(false);
    expect(result.current.isPractitioner).toBe(true);
    expect(result.current.hasRole('practitioner')).toBe(true);
  });

  it('should identify member user correctly', async () => {
    mockRpc.mockResolvedValue({ data: [mockMemberRole], error: null });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStaff).toBe(false);
    expect(result.current.isPractitioner).toBe(false);
    expect(result.current.hasRole('member')).toBe(true);
  });

  it('should handle user with multiple roles', async () => {
    mockRpc.mockResolvedValue({ 
      data: [mockStaffRole, mockPractitionerRole], 
      error: null 
    });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.roles).toHaveLength(2);
    expect(result.current.hasRole('staff')).toBe(true);
    expect(result.current.hasRole('practitioner')).toBe(true);
    expect(result.current.isStaff).toBe(true);
    expect(result.current.isPractitioner).toBe(true);
  });

  it('should handle user with no roles', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.roles).toEqual([]);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStaff).toBe(false);
    expect(result.current.isPractitioner).toBe(false);
  });

  it('should handle database error gracefully', async () => {
    mockRpc.mockResolvedValue({ 
      data: null, 
      error: new Error('Database error') 
    });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.roles).toEqual([]);
  });

  it('should provide refetch function', async () => {
    mockRpc.mockResolvedValue({ data: [mockMemberRole], error: null });

    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Update mock to return different data
    mockRpc.mockResolvedValue({ data: [mockAdminRole], error: null });

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(true);
    });
  });

  // 2026-10-01 (na instanci): tichá obnova tokenu (každé ~3 min) přinese tentýž účet
  // v novém objektu. Role se nesmí znovu načítat ani přepnout `loading` —
  // ochrana adminu by jinak odmontovala otevřený editor stránek.
  it('nový objekt téhož účtu (tichá obnova) nenačítá role znovu ani nepřepne loading', async () => {
    mockRpc.mockResolvedValue({ data: [mockAdminRole], error: null });
    const { result, rerender } = renderHook(() => useUserRole());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);

    mockUseAuth.mockReturnValue({
      user: { ...mockUser },
      loading: false,
      isAuthenticated: true,
      session: { user: { ...mockUser } },
      signOut: vi.fn(),
    });
    act(() => {
      rerender();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.isAdmin).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('jiný účet (jiné id) role načte znovu', async () => {
    mockRpc.mockResolvedValue({ data: [mockAdminRole], error: null });
    const { result, rerender } = renderHook(() => useUserRole());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockRpc.mockResolvedValue({ data: [mockMemberRole], error: null });
    mockUseAuth.mockReturnValue({
      user: { ...mockUser, id: 'jiny-ucet' },
      loading: false,
      isAuthenticated: true,
      session: { user: { ...mockUser, id: 'jiny-ucet' } },
      signOut: vi.fn(),
    });
    act(() => {
      rerender();
    });

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(false);
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('should call rpc with correct function name', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useUserRole());

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_my_user_roles');
    });
  });
});

describe('useUserRole without user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock useAuth to return no user
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      loading: false,
      session: null,
      signOut: vi.fn(),
    });
  });

  it('should return empty roles when user is null', async () => {
    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.roles).toEqual([]);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isStaff).toBe(false);
    expect(result.current.isPractitioner).toBe(false);
  });

  it('should not call rpc when user is null', async () => {
    const { result } = renderHook(() => useUserRole());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockRpc).not.toHaveBeenCalled();
  });
});
