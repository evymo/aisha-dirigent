import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import type { KcSession as Session, KcUser as User } from '@/integrations/auth/types';
import type { AppRole } from '@/hooks/useUserRole';

let mockAuth = {
  session: null as Session | null,
  user: { id: 'user-1', email: 'user@example.com' } as unknown as User | null,
  loading: false,
  signOut: vi.fn(async () => {}),
};

let mockUserRole = {
  roles: [{ id: 'r1', user_id: 'user-1', role: 'member' as AppRole, granted_by: '', granted_at: '' }],
  loading: false,
  hasRole: vi.fn(() => true),
  isAdmin: false,
  refetch: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('@/hooks/useUserRole', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useUserRole')>();
  return {
    ...actual,
    useUserRole: () => mockUserRole,
  };
});

describe('useSession', () => {
  beforeEach(() => {
    mockAuth = {
      session: null,
      user: { id: 'user-1', email: 'user@example.com' } as unknown as User,
      loading: false,
      signOut: vi.fn(async () => {}),
    };
    mockUserRole = {
      roles: [{ id: 'r1', user_id: 'user-1', role: 'member' as AppRole, granted_by: '', granted_at: '' }],
      loading: false,
      hasRole: vi.fn(() => true),
      isAdmin: false,
      refetch: vi.fn(async () => {}),
    };
  });

  it('throws when used outside of SessionProvider', async () => {
    const { useSession } = await import('@/hooks/useSession');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSession())).toThrow('useSession must be used within a SessionProvider');
    consoleErrorSpy.mockRestore();
  });

  it('provides derived roles and loading state', async () => {
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });

    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.roles).toEqual(['member']);
    expect(result.current.hasRole('member')).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('sets isLoading when auth or role loading', async () => {
    mockAuth.loading = true;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('sets isLoading when role loading', async () => {
    mockUserRole.loading = true;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('exposes roleRecords with full role objects', async () => {
    mockUserRole.roles = [
      { id: 'r1', user_id: 'user-1', role: 'member' as AppRole, granted_by: '', granted_at: '' },
      { id: 'r2', user_id: 'user-1', role: 'staff' as AppRole, granted_by: '', granted_at: '' },
    ];
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.roleRecords).toHaveLength(2);
    expect(result.current.roleRecords[0].role).toBe('member');
    expect(result.current.roleRecords[1].role).toBe('staff');
  });

  it('derives roles array from roleRecords', async () => {
    mockUserRole.roles = [
      { id: 'r1', user_id: 'user-1', role: 'practitioner' as AppRole, granted_by: '', granted_at: '' },
      { id: 'r2', user_id: 'user-1', role: 'admin' as AppRole, granted_by: '', granted_at: '' },
    ];
    mockUserRole.isAdmin = true;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.roles).toEqual(['practitioner', 'admin']);
    expect(result.current.isAdmin).toBe(true);
  });

  it('wraps hasRole to only accept allowed AppRoles', async () => {
    mockUserRole.hasRole = vi.fn((role: string) => role === 'admin') as unknown as typeof mockUserRole.hasRole;
    mockUserRole.isAdmin = true;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    
    // Valid role
    expect(result.current.hasRole('admin')).toBe(true);
    expect(result.current.hasRole('member')).toBe(false);
    
    // Invalid role should return false (not in allowed set)
    expect(result.current.hasRole('invalid-role' as unknown as AppRole)).toBe(false);
  });

  it('exposes session and user from useAuth', async () => {
    const mockSession = { access_token: 'token-123', user: mockAuth.user } as unknown as Session;
    mockAuth.session = mockSession;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.session).toBe(mockSession);
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.user?.email).toBe('user@example.com');
  });

  it('exposes refetchRoles function', async () => {
    const mockRefetch = vi.fn(async () => {});
    mockUserRole.refetch = mockRefetch;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    
    await result.current.refetchRoles();
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it('exposes signOut function from useAuth', async () => {
    const mockSignOut = vi.fn(async () => {});
    mockAuth.signOut = mockSignOut;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    
    await result.current.signOut();
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it('handles unauthenticated state (no user)', async () => {
    mockAuth.user = null;
    mockAuth.session = null;
    mockUserRole.roles = [];
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.roles).toEqual([]);
    expect(result.current.isAdmin).toBe(false);
  });

  it('handles user with no roles', async () => {
    mockUserRole.roles = [];
    mockUserRole.hasRole = vi.fn(() => false);
    mockUserRole.isAdmin = false;
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.roles).toEqual([]);
    expect(result.current.hasRole('member')).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });

  it('checks all allowed roles correctly', async () => {
    const allowedRoles = ['admin', 'staff', 'practitioner', 'member', 'evaluator'];
    mockUserRole.hasRole = vi.fn((role: string) => allowedRoles.includes(role));
    const { SessionProvider, useSession } = await import('@/hooks/useSession');

    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });
    
    allowedRoles.forEach(role => {
      expect(result.current.hasRole(role)).toBe(true);
    });
  });
});
