import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor, act, cleanup } from '@testing-library/react';
import { renderHookWithProviders } from '@/tests/utils/test-utils';

// Mock data
const mockRpcConsent = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  user_id: '550e8400-e29b-41d4-a716-446655440003',
  partner_id: '550e8400-e29b-41d4-a716-446655440002',
  granted_at: '2024-01-01T00:00:00Z',
  revoked_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  partner_profile: {
    id: '550e8400-e29b-41d4-a716-446655440002',
    display_name: 'Dr. Smith',
    business_name: 'Smith Clinic',
    city: 'Prague',
    certification_level: 'certified_partner',
  },
};

const mockAvailablePartner = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  display_name: 'Dr. Smith',
  business_name: 'Smith Clinic',
  city: 'Prague',
  certification_level: 'certified_partner',
  has_consent: false,
};

// Hoisted mocks
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
  useSession: () => hoisted.useSessionMock() 
}));

// Import after mocks
import { 
  useDataSharingConsents, 
  useAvailablePartnersForSharing,
  useGrantDataSharing,
  useRevokeDataSharing,
  useConsentedUsers,
} from '@/hooks/useDataSharingConsent';

// Global cleanup after each test
afterEach(() => {
  cleanup();
});

describe('useDataSharingConsents', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ 
      user: { id: 'user-123' }, 
      session: { user: { id: 'user-123' } }, 
      isLoading: false 
    });
  });

  it('should fetch user consents via RPC', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [mockRpcConsent], error: null });

    const { result } = renderHookWithProviders(() => useDataSharingConsents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_my_data_sharing_consents');
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.length).toBe(1);
  });

  it('should return empty array when no consents exist', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHookWithProviders(() => useDataSharingConsents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should handle RPC error', async () => {
    hoisted.rpcMock.mockResolvedValue({ 
      data: null, 
      error: { message: 'Database error', code: 'PGRST000' } 
    });

    const { result } = renderHookWithProviders(() => useDataSharingConsents());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('should not fetch when user is null', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: null, session: null, isLoading: false });

    const { result } = renderHookWithProviders(() => useDataSharingConsents());

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });
});

describe('useAvailablePartnersForSharing', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ 
      user: { id: 'user-123' }, 
      session: { user: { id: 'user-123' } }, 
      isLoading: false 
    });
  });

  it('should fetch available partners via RPC', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [mockAvailablePartner], error: null });

    const { result } = renderHookWithProviders(() => useAvailablePartnersForSharing());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_available_partners_for_sharing');
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.length).toBe(1);
  });

  it('should return empty array when no partners available', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHookWithProviders(() => useAvailablePartnersForSharing());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should handle RPC error', async () => {
    hoisted.rpcMock.mockResolvedValue({ 
      data: null, 
      error: { message: 'Database error', code: 'PGRST000' } 
    });

    const { result } = renderHookWithProviders(() => useAvailablePartnersForSharing());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});

describe('useGrantDataSharing', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ 
      user: { id: 'user-123' }, 
      session: { user: { id: 'user-123' } }, 
      isLoading: false 
    });
  });

  it('should grant consent via RPC', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHookWithProviders(() => useGrantDataSharing());

    await act(async () => {
      await result.current.mutateAsync('partner-456');
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('grant_data_sharing_consent', { p_partner_id: 'partner-456' });
  });

  it('should handle mutation error', async () => {
    hoisted.rpcMock.mockResolvedValue({ 
      data: null, 
      error: { message: 'Failed to grant consent', code: 'PGRST000' } 
    });

    const { result } = renderHookWithProviders(() => useGrantDataSharing());

    let thrownError: Error | null = null;
    try {
      await act(async () => {
        await result.current.mutateAsync('partner-456');
      });
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).toBeTruthy();
  });
});

describe('useRevokeDataSharing', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ 
      user: { id: 'user-123' }, 
      session: { user: { id: 'user-123' } }, 
      isLoading: false 
    });
  });

  it('should revoke consent via RPC', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: { success: true }, error: null });

    const { result } = renderHookWithProviders(() => useRevokeDataSharing());

    await act(async () => {
      await result.current.mutateAsync('consent-123');
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('revoke_data_sharing_consent', { p_consent_id: 'consent-123' });
  });

  it('should handle mutation error', async () => {
    hoisted.rpcMock.mockResolvedValue({ 
      data: null, 
      error: { message: 'Failed to revoke consent', code: 'PGRST000' } 
    });

    const { result } = renderHookWithProviders(() => useRevokeDataSharing());

    let thrownError: Error | null = null;
    try {
      await act(async () => {
        await result.current.mutateAsync('consent-123');
      });
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).toBeTruthy();
  });
});

describe('useConsentedUsers', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
    hoisted.useSessionMock.mockReset();
    hoisted.useSessionMock.mockReturnValue({ 
      user: { id: 'user-123' }, 
      session: { user: { id: 'user-123' } }, 
      isLoading: false 
    });
  });

  it('should fetch consented users via RPC', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: ['user-789', 'user-101'], error: null });

    const { result } = renderHookWithProviders(() => useConsentedUsers());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_consented_users');
    expect(result.current.data).toEqual(['user-789', 'user-101']);
  });

  it('should return empty array when no consented users', async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHookWithProviders(() => useConsentedUsers());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should handle RPC error gracefully', async () => {
    hoisted.rpcMock.mockResolvedValue({ 
      data: null, 
      error: { message: 'Not found', code: 'PGRST000' } 
    });

    const { result } = renderHookWithProviders(() => useConsentedUsers());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });

  it('should not fetch when user is null', async () => {
    hoisted.useSessionMock.mockReturnValue({ user: null, session: null, isLoading: false });

    const { result } = renderHookWithProviders(() => useConsentedUsers());

    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });

    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });
});
