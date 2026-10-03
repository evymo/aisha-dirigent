import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock oidc-client functions (useAuthActions imports from @/integrations/auth/oidc-client)
const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockGetAccountUrl = vi.fn();

vi.mock('@/integrations/auth/oidc-client', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
  getUser: (...args: unknown[]) => mockGetUser(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getAccountUrl: (...args: unknown[]) => mockGetAccountUrl(...args),
}));

import {
  useOAuthLogin,
  useLogin,
  useSignOut,
  useUpdatePassword,
  useAuthSession,
  useCurrentUser,
  useSendMagicLink,
  useVerifyOtp,
  usePasswordLogin,
} from '@/hooks/useAuthActions';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useAuthActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue(undefined);
    mockLogout.mockResolvedValue(undefined);
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    mockGetSession.mockResolvedValue({ access_token: 'token', user: { id: 'user-1' } });
    mockGetAccountUrl.mockReturnValue('https://kc.example.com/account/password');
  });

  describe('useOAuthLogin', () => {
    it('calls oidcLogin with idpHint from provider', async () => {
      const { result } = renderHook(() => useOAuthLogin(), { wrapper: createWrapper() });

      await result.current.mutateAsync({
        provider: 'google',
        redirectUrl: 'https://app.com/callback',
      });

      expect(mockLogin).toHaveBeenCalledWith({
        idpHint: 'google',
        returnPath: 'https://app.com/callback',
      });
    });

    it('throws on login error', async () => {
      mockLogin.mockRejectedValue(new Error('Provider not configured'));

      const { result } = renderHook(() => useOAuthLogin(), { wrapper: createWrapper() });

      await expect(
        result.current.mutateAsync({ provider: 'keycloak', redirectUrl: 'https://app.com' })
      ).rejects.toThrow('Provider not configured');
    });
  });

  describe('useLogin', () => {
    it('calls oidcLogin with optional returnPath', async () => {
      const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

      await result.current.mutateAsync('/dashboard');

      expect(mockLogin).toHaveBeenCalledWith({ returnPath: '/dashboard' });
    });

    it('calls oidcLogin without returnPath', async () => {
      const { result } = renderHook(() => useLogin(), { wrapper: createWrapper() });

      await result.current.mutateAsync(undefined);

      expect(mockLogin).toHaveBeenCalledWith({ returnPath: undefined });
    });
  });

  describe('useSignOut', () => {
    it('calls oidcLogout', async () => {
      const { result } = renderHook(() => useSignOut(), { wrapper: createWrapper() });

      await result.current.mutateAsync();

      expect(mockLogout).toHaveBeenCalled();
    });

    it('throws on signOut error', async () => {
      mockLogout.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSignOut(), { wrapper: createWrapper() });

      await expect(result.current.mutateAsync()).rejects.toThrow('Network error');
    });
  });

  describe('useUpdatePassword', () => {
    it('redirects to KC account password page', async () => {
      const assignSpy = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, set href(v: string) { assignSpy(v); } },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useUpdatePassword(), { wrapper: createWrapper() });

      await result.current.mutateAsync();

      expect(mockGetAccountUrl).toHaveBeenCalledWith('password');
      expect(assignSpy).toHaveBeenCalledWith('https://kc.example.com/account/password');
    });
  });

  describe('useAuthSession', () => {
    it('returns session data', async () => {
      const { result } = renderHook(() => useAuthSession(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(result.current.data).toEqual({ access_token: 'token', user: { id: 'user-1' } });
    });

    it('throws when no session', async () => {
      mockGetSession.mockResolvedValue(null);

      const { result } = renderHook(() => useAuthSession(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });
    });
  });

  describe('useCurrentUser', () => {
    it('returns current user', async () => {
      const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(result.current.data).toEqual({ id: 'user-1', email: 'user@example.com' });
    });

    it('throws when not authenticated', async () => {
      mockGetUser.mockResolvedValue(null);

      const { result } = renderHook(() => useCurrentUser(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.error).toBeDefined();
      });
    });
  });

  describe('deprecated stubs', () => {
    it('useSendMagicLink throws', async () => {
      const { result } = renderHook(() => useSendMagicLink(), { wrapper: createWrapper() });

      await expect(result.current.mutateAsync()).rejects.toThrow('Magic link is not supported');
    });

    it('useVerifyOtp throws', async () => {
      const { result } = renderHook(() => useVerifyOtp(), { wrapper: createWrapper() });

      await expect(result.current.mutateAsync()).rejects.toThrow('OTP verification is not supported');
    });

    it('usePasswordLogin throws', async () => {
      const { result } = renderHook(() => usePasswordLogin(), { wrapper: createWrapper() });

      await expect(result.current.mutateAsync()).rejects.toThrow('Password login is handled by Keycloak');
    });
  });
});
