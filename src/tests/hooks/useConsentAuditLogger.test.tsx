import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

const logAndRewardConsentActionMock = vi.fn();
const logConsentActionMock = vi.fn();
const processConsentRewardMock = vi.fn();

vi.mock('@/lib/security/consentAuditLogger', () => ({
  logAndRewardConsentAction: (...args: unknown[]) => logAndRewardConsentActionMock(...args),
  logConsentAction: (...args: unknown[]) => logConsentActionMock(...args),
  processConsentReward: (...args: unknown[]) => processConsentRewardMock(...args),
}));

let mockUser: { id: string } | null = { id: 'user-1' };
vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ user: mockUser }),
}));

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useConsentAuditLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'user-1' };
    logAndRewardConsentActionMock.mockResolvedValue({ logSuccess: true, rewardSuccess: true });
    logConsentActionMock.mockResolvedValue({ success: true, journalId: 'journal-1' });
    processConsentRewardMock.mockResolvedValue({ success: true, amount: 10, transactionId: 'tx-1' });
  });

  it('invalidates relevant queries on logAndReward success', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { useConsentAuditLogger } = await import('@/hooks/useConsentAuditLogger');

    const { result } = renderHook(() => useConsentAuditLogger(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.logAndReward.mutateAsync({
        actionType: 'consent_granted',
        entityType: 'consent',
        entityId: 'consent-1',
        summary: 'Granted',
      });
    });

    expect(logAndRewardConsentActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['memberships'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['all-token-transactions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['audit-journal'] });
  });

  it('throws when called without an authenticated user', async () => {
    mockUser = null;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { useConsentAuditLogger } = await import('@/hooks/useConsentAuditLogger');

    const { result } = renderHook(() => useConsentAuditLogger(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.logOnly.mutateAsync({
        actionType: 'consent_revoked',
        entityType: 'consent',
        entityId: 'consent-1',
        summary: 'Revoked',
      }),
    ).rejects.toThrow('User not authenticated');
  });

  it('invalidates audit journal on logOnly success and passes payload', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { useConsentAuditLogger } = await import('@/hooks/useConsentAuditLogger');

    const { result } = renderHook(() => useConsentAuditLogger(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.logOnly.mutateAsync({
        actionType: 'consent_revoked',
        entityType: 'consent',
        entityId: 'consent-1',
        summary: 'Revoked',
        details: { consent_type: 'data_processing' },
        oldValues: { granted: true },
        newValues: { granted: false },
      });
    });

    expect(logConsentActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'consent_revoked',
        entityType: 'consent',
        entityId: 'consent-1',
        summary: 'Revoked',
        details: { consent_type: 'data_processing' },
        oldValues: { granted: true },
        newValues: { granted: false },
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['audit-journal'] });
  });

  it('invalidates memberships and transactions on rewardOnly success', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { useConsentAuditLogger } = await import('@/hooks/useConsentAuditLogger');

    const { result } = renderHook(() => useConsentAuditLogger(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.rewardOnly.mutateAsync({
        actionType: 'health_checkin_completed',
        referenceId: 'checkin-1',
      });
    });

    expect(processConsentRewardMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', actionType: 'health_checkin_completed', referenceId: 'checkin-1' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['memberships'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['all-token-transactions'] });
  });

  it('rewardOnly throws when called without an authenticated user', async () => {
    mockUser = null;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { useConsentAuditLogger } = await import('@/hooks/useConsentAuditLogger');

    const { result } = renderHook(() => useConsentAuditLogger(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.rewardOnly.mutateAsync({
        actionType: 'document_uploaded',
        referenceId: 'doc-1',
      }),
    ).rejects.toThrow('User not authenticated');
  });
});

