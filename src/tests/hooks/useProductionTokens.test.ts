import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '../utils/test-utils';

// Hoisted mock for aisha.rpc
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: rpcMock,
  },
}));

import {
  useProductionTokenEvents,
  useProductionTokenStats,
  AUTOMATIC_TRIGGERS,
  PRODUCTION_TOKEN_FLOW,
} from '@/hooks/useProductionTokens';

describe('useProductionTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches production token events with limit via RPC', async () => {
    const mockCreatedAt = new Date().toISOString();
    const rpcData = [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        protocol_step_id: null,
        batch_id: null,
        event_type: 'mint',
        token_type: 'production',
        amount: 10,
        reason: 'test',
        description: null,
        reference_volume: 5,
        loss_volume: null,
        created_by: null,
        created_at: mockCreatedAt,
        batch_code: 'B-1',
        product_name: 'Prod',
      },
    ];

    rpcMock.mockResolvedValue({ data: rpcData, error: null });

    const { result } = renderHookWithProviders(() => useProductionTokenEvents(25));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify RPC was called with correct function and limit
    expect(rpcMock).toHaveBeenCalledWith('get_production_token_events', { p_limit: 25 });

    // Verify data transformation (flat RPC result -> nested batch structure)
    expect(result.current.data).toEqual([
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        protocol_step_id: null,
        batch_id: null,
        event_type: 'mint',
        token_type: 'production',
        amount: 10,
        reason: 'test',
        description: null,
        reference_volume: 5,
        loss_volume: null,
        created_by: null,
        created_at: mockCreatedAt,
        batch: { batch_code: 'B-1', product_name: 'Prod' },
      },
    ]);
  });

  it('computes production token stats correctly via RPC', async () => {
    const rpcData = [
      { event_type: 'mint', amount: 10, reference_volume: 5, loss_volume: 0 },
      { event_type: 'mint', amount: 20, reference_volume: 7, loss_volume: 0 },
      { event_type: 'burn', amount: 5, reference_volume: 0, loss_volume: 2 },
    ];

    rpcMock.mockResolvedValue({ data: rpcData, error: null });

    const { result } = renderHookWithProviders(() => useProductionTokenStats());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify RPC was called
    expect(rpcMock).toHaveBeenCalledWith('get_production_token_stats');

    // Verify computed stats
    expect(result.current.data).toEqual({
      totalMinted: 30,
      totalBurned: 5,
      netTokens: 25,
      mintEvents: 2,
      burnEvents: 1,
      totalVolume: 12,
      totalLoss: 2,
      efficiencyRate: ((12 - 2) / 12) * 100,
    });
  });

  it('handles RPC error for token events', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

    const { result } = renderHookWithProviders(() => useProductionTokenEvents());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(rpcMock).toHaveBeenCalledWith('get_production_token_events', { p_limit: 50 });
  });

  it('handles RPC error for token stats', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

    const { result } = renderHookWithProviders(() => useProductionTokenStats());

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(rpcMock).toHaveBeenCalledWith('get_production_token_stats');
  });

  it('handles empty RPC data for stats', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHookWithProviders(() => useProductionTokenStats());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({
      totalMinted: 0,
      totalBurned: 0,
      netTokens: 0,
      mintEvents: 0,
      burnEvents: 0,
      totalVolume: 0,
      totalLoss: 0,
      efficiencyRate: 100,
    });
  });

  it('exports trigger and flow constants', () => {
    expect(Array.isArray(AUTOMATIC_TRIGGERS)).toBe(true);
    expect(AUTOMATIC_TRIGGERS.length).toBeGreaterThan(0);

    expect(PRODUCTION_TOKEN_FLOW).toHaveProperty('minting');
    expect(PRODUCTION_TOKEN_FLOW).toHaveProperty('burning');
    expect(PRODUCTION_TOKEN_FLOW.minting).toHaveProperty('rate');
  });
});
