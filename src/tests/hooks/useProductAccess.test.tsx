import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/tests/utils/test-utils';
import { useSystemConfig } from '@/hooks/useProductAccess';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

describe('useSystemConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls get_system_config with explicit p_key payload key', async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: {
        session_timeout_minutes: 45,
        secure_session_timeout_minutes: 20,
      },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useSystemConfig());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_system_config', {
      p_key: undefined,
    });
    expect(result.current.data?.session_timeout_minutes).toBe(45);
    expect(result.current.data?.secure_session_timeout_minutes).toBe(20);
  });
});
