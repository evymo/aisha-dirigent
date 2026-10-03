import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '../utils/test-utils';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

import { useAuditJournal, useAuditJournalStats } from '@/hooks/useAuditJournal';

describe('useAuditJournal', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it('fetches audit journal with default limit', async () => {
    const mockEntries = [
      {
        id: 'a1',
        created_at: new Date().toISOString(),
        user_id: null,
        user_email: null,
        user_role: null,
        action_type: 'system_event',
        entity_type: 'system',
        entity_id: null,
        area: 'system',
        severity: 'info',
        summary: 'Event',
        details: null,
        old_values: null,
        new_values: null,
        blockchain_hash: null,
        blockchain_tx_hash: null,
        blockchain_status: null,
        tags: null,
      },
    ];

    hoisted.rpcMock.mockReturnValue(Promise.resolve({ data: mockEntries, error: null }));

    const { result } = renderHookWithProviders(() => useAuditJournal());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toEqual(mockEntries);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_audit_journal', {
      p_area: undefined,
      p_severity: undefined,
      p_action_type: undefined,
      p_entity_type: undefined,
      p_start_date: undefined,
      p_end_date: undefined,
      p_search: undefined,
      p_limit: 100,
    });
  });

  it('applies filters correctly via RPC params', async () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-31T23:59:59.000Z');

    hoisted.rpcMock.mockReturnValue(Promise.resolve({ data: [], error: null }));

    const { result } = renderHookWithProviders(() =>
      useAuditJournal({
        area: 'auth',
        severity: 'warning',
        actionType: 'login',
        entityType: 'user',
        startDate: start,
        endDate: end,
        search: 'alice',
        limit: 50,
      })
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_audit_journal', {
      p_area: 'auth',
      p_severity: 'warning',
      p_action_type: 'login',
      p_entity_type: 'user',
      p_start_date: start.toISOString(),
      p_end_date: end.toISOString(),
      p_search: 'alice',
      p_limit: 50,
    });
  });

  it('surfaces Supabase error as react-query error', async () => {
    hoisted.rpcMock.mockReturnValue(Promise.resolve({ data: null, error: { message: 'Boom' } }));

    const { result } = renderHookWithProviders(() => useAuditJournal());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useAuditJournalStats', () => {
  beforeEach(() => {
    hoisted.rpcMock.mockReset();
  });

  it('computes stats from fetched rows', async () => {
    // RPC get_audit_journal_stats_24h returns: action, area, severity, count
    const mockData = [
      { area: 'auth', action: 'login', severity: 'info', count: 1 },
      { area: 'auth', action: 'login', severity: 'info', count: 1 },
      { area: 'orders', action: 'create', severity: 'warning', count: 1 },
    ];

    hoisted.rpcMock.mockReturnValue(Promise.resolve({ data: mockData, error: null }));

    const { result } = renderHookWithProviders(() => useAuditJournalStats());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({
      total: 3,
      byArea: { auth: 2, orders: 1 },
      bySeverity: { info: 2, warning: 1 },
      byAction: { login: 2, create: 1 },
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith('get_audit_journal_stats_24h');
  });

  it('handles RPC error gracefully', async () => {
    hoisted.rpcMock.mockReturnValue(Promise.resolve({ data: null, error: { message: 'Stats error' } }));

    const { result } = renderHookWithProviders(() => useAuditJournalStats());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
