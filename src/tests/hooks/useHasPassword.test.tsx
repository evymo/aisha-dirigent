import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, act } from '@testing-library/react';
import { renderHookWithProviders } from '@/tests/utils/test-utils';

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

vi.mock('@/hooks/useSession', () => ({
  useSession: () => hoisted.useSessionMock(),
}));

import { useHasPassword, useMarkPasswordSet } from '@/hooks/useHasPassword';

const mockUser = { id: 'user-123' };

describe('useHasPassword hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ user: mockUser });
  });

  describe('useHasPassword', () => {
    it('returns true when user has password', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: true,
        error: null,
      });

      const { result } = renderHookWithProviders(() => useHasPassword());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('check_user_has_password', {
        p_user_id: 'user-123',
      });
      expect(result.current.hasPassword).toBe(true);
    });

    it('returns false when user has no password (Magic Link)', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: false,
        error: null,
      });

      const { result } = renderHookWithProviders(() => useHasPassword());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasPassword).toBe(false);
    });

    it('returns false when not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useHasPassword());

      // Should return false immediately without fetching
      expect(result.current.hasPassword).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(hoisted.rpcMock).not.toHaveBeenCalled();
    });

    it('returns false on RPC error (fail-safe)', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useHasPassword());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should fail-safe to false
      expect(result.current.hasPassword).toBe(false);
    });

    it('handles non-boolean response gracefully', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null, // Not a boolean
        error: null,
      });

      const { result } = renderHookWithProviders(() => useHasPassword());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should fallback to false
      expect(result.current.hasPassword).toBe(false);
    });
  });

  describe('useMarkPasswordSet', () => {
    it('calls RPC to mark password set', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useMarkPasswordSet());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('mark_password_set');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['has-password', 'user-123'] });
    });

    it('throws when not authenticated', async () => {
      hoisted.useSessionMock.mockReturnValue({ user: null });

      const { result } = renderHookWithProviders(() => useMarkPasswordSet());

      await expect(
        act(async () => {
          await result.current.mutateAsync();
        })
      ).rejects.toThrow('Not authenticated');
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Cannot update password status' },
      });

      const { result } = renderHookWithProviders(() => useMarkPasswordSet());

      let thrownError: Error | null = null;
      try {
        await act(async () => {
          await result.current.mutateAsync();
        });
      } catch (e) {
        thrownError = e as Error;
      }

      expect(thrownError).not.toBeNull();
    });
  });
});
