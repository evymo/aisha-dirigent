import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import type { KcUser, KcSession } from '@/integrations/auth/types';

/** Mock KcUser */
const mockKcUser: KcUser = {
  id: 'user-123',
  email: 'test@example.com',
  email_verified: true,
  display_name: 'Test User',
  given_name: 'Test',
  family_name: 'User',
  raw_claims: { roles: ['member'], realm_roles: ['member'] },
};

/** Mock KcSession */
const mockKcSession: KcSession = {
  access_token: 'mock-access-token',
  id_token: 'mock-id-token',
  refresh_token: 'mock-refresh',
  token_type: 'Bearer',
  expires_at: Date.now() / 1000 + 3600,
  user: mockKcUser,
};

// Mock oidc-client functions
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockLogout = vi.fn();
const mockBroadcastSignOut = vi.fn();
const mockMapOidcUser = vi.fn();
const mockMapOidcSession = vi.fn();

// UserManager event handlers — captured during useEffect
const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {
  userLoaded: [],
  userUnloaded: [],
  silentRenewError: [],
  accessTokenExpired: [],
};

const mockEvents = {
  addUserLoaded: vi.fn((fn: () => void) => { eventHandlers.userLoaded.push(fn); }),
  addUserUnloaded: vi.fn((fn: () => void) => { eventHandlers.userUnloaded.push(fn); }),
  addSilentRenewError: vi.fn((fn: () => void) => { eventHandlers.silentRenewError.push(fn); }),
  addAccessTokenExpired: vi.fn((fn: () => void) => { eventHandlers.accessTokenExpired.push(fn); }),
  removeUserLoaded: vi.fn(),
  removeUserUnloaded: vi.fn(),
  removeSilentRenewError: vi.fn(),
  removeAccessTokenExpired: vi.fn(),
};

const mockGetUserManager = vi.fn(() => ({ events: mockEvents }));

const mockChannel = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  postMessage: vi.fn(),
  close: vi.fn(),
};
const mockGetAuthChannel = vi.fn(() => mockChannel as unknown);

vi.mock('@/integrations/auth/oidc-client', () => ({
  getUserManager: () => mockGetUserManager(),
  getUser: (...args: unknown[]) => mockGetUser(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
  broadcastSignOut: (...args: unknown[]) => mockBroadcastSignOut(...args),
  getAuthChannel: () => mockGetAuthChannel(),
  mapOidcUser: (...args: unknown[]) => mockMapOidcUser(...args),
  mapOidcSession: (...args: unknown[]) => mockMapOidcSession(...args),
}));

import { useAuth } from '@/hooks/useAuth';

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset event handler arrays
    eventHandlers.userLoaded = [];
    eventHandlers.userUnloaded = [];
    eventHandlers.silentRenewError = [];
    eventHandlers.accessTokenExpired = [];

    mockGetUser.mockResolvedValue(mockKcUser);
    mockGetSession.mockResolvedValue(mockKcSession);
    mockLogout.mockResolvedValue(undefined);
  });

  it('should initialize with loading state', async () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBe(null);
    expect(result.current.session).toBe(null);
    expect(result.current.isAuthenticated).toBe(false);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should set user and session after getUser/getSession resolves', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockKcUser);
    expect(result.current.session).toEqual(mockKcSession);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should handle no session', async () => {
    mockGetUser.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(null);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBe(null);
    expect(result.current.session).toBe(null);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should call oidcLogout on signOut', async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockBroadcastSignOut).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
  });

  it('should unsubscribe event handlers on unmount', async () => {
    const { unmount, result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    unmount();

    expect(mockEvents.removeUserLoaded).toHaveBeenCalled();
    expect(mockEvents.removeUserUnloaded).toHaveBeenCalled();
    expect(mockEvents.removeSilentRenewError).toHaveBeenCalled();
    expect(mockEvents.removeAccessTokenExpired).toHaveBeenCalled();
  });

  it('should update user when userLoaded event fires', async () => {
    const newUser: KcUser = { ...mockKcUser, email: 'new@example.com' };
    const newSession: KcSession = { ...mockKcSession, user: newUser };

    mockMapOidcUser.mockReturnValue(newUser);
    mockMapOidcSession.mockReturnValue(newSession);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Simulate userLoaded event from OIDC UserManager
    act(() => {
      eventHandlers.userLoaded.forEach((fn) => fn({ profile: { sub: 'user-123' } }));
    });

    await waitFor(() => {
      expect(result.current.user?.email).toBe('new@example.com');
    });
  });
});
