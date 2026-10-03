import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/integrations/db/client', async () => {
  const actual = await vi.importActual<typeof import('@/integrations/db/client')>(
    '@/integrations/db/client',
  );
  return {
    ...actual,
    aisha: {
      ...actual.aisha,
      rpc: rpcMock,
    },
  };
});

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: vi.fn(),
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

describe('consentAuditLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockImplementation(async (fnName: string) => {
      if (fnName === 'write_my_audit_journal_entry') {
        return { data: 'journal-1', error: null };
      }

      if (fnName === 'process_token_reward') {
        return {
          data: { success: true, transaction_id: 'tx-1', amount_awarded: 10, new_balance: 100 },
          error: null,
        };
      }

      return { data: null, error: null };
    });
  });

  it('logs a consent action with mapped journal fields', async () => {
    const { logConsentAction } = await import('@/lib/security/consentAuditLogger');

    const result = await logConsentAction({
      actionType: 'consent_granted',
      entityType: 'consent',
      entityId: 'consent-1',
      summary: 'Granted',
      details: { consent_type: 'data_processing' },
    });

    expect(result.success).toBe(true);
    expect(result.journalId).toBe('journal-1');
    expect(rpcMock).toHaveBeenCalledWith('write_my_audit_journal_entry', expect.objectContaining({
      p_action_type: 'approve',
      p_area: 'consents',
      p_entity_type: 'consent',
      p_entity_id: 'consent-1',
      p_summary: 'Granted',
      p_details: { consent_type: 'data_processing' },
    }));

    // The actor must NOT be client-supplied: write_my_audit_journal_entry has no p_user_id and
    // pins the entry to auth.uid() in the DB. Sending one again would mean the attribution-forgery
    // door (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md) had been reopened. Severity is
    // likewise fixed server-side, so the client must not choose it either.
    const [, params] = rpcMock.mock.calls[0];
    expect(params).not.toHaveProperty('p_user_id');
    expect(params).not.toHaveProperty('p_severity');
  });

  it('returns failure when audit insert fails', async () => {
    const { logConsentAction } = await import('@/lib/security/consentAuditLogger');

    rpcMock.mockImplementationOnce(async (fnName: string) => {
      if (fnName === 'write_my_audit_journal_entry') {
        return { data: null, error: new Error('insert failed') };
      }
      return { data: null, error: null };
    });

    const result = await logConsentAction({
      actionType: 'consent_revoked',
      entityType: 'consent',
      entityId: 'consent-1',
      summary: 'Revoked',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('processes a consent reward via RPC', async () => {
    const { processConsentReward } = await import('@/lib/security/consentAuditLogger');

    const result = await processConsentReward({
      userId: 'user-1',
      actionType: 'questionnaire_completed',
      referenceId: 'q-1',
    });

    expect(result.success).toBe(true);
    expect(result.amount).toBe(10);
    expect(result.transactionId).toBe('tx-1');
    expect(rpcMock).toHaveBeenCalledWith('process_token_reward', {
      p_user_id: 'user-1',
      p_action_type: 'questionnaire_completed',
      p_reference_id: 'q-1',
    });
  });

  it('combines audit logging and rewards', async () => {
    const { logAndRewardConsentAction } = await import('@/lib/security/consentAuditLogger');

    const result = await logAndRewardConsentAction({
      userId: 'user-1',
      actionType: 'health_checkin_completed',
      entityType: 'checkin',
      entityId: 'checkin-1',
      summary: 'Check-in completed',
    });

    expect(result.logSuccess).toBe(true);
    expect(result.rewardSuccess).toBe(true);
    expect(result.journalId).toBe('journal-1');
    expect(result.rewardAmount).toBe(10);
  });

});
