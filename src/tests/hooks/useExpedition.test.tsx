import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, act } from '@testing-library/react';
import { renderHookWithProviders } from '@/tests/utils/test-utils';

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock('@/integrations/db/client', () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    user: { id: 'test-user-id', email: 'test@example.com' },
    session: { access_token: 'test-token' },
  }),
}));

import {
  useExpeditionCalendar,
  useBatchAvailability,
  useBatchAllocation,
  useBatchInventory,
} from '@/hooks/useExpedition';

// Mock data matching Zod schemas from rpcSchemas.ts
const mockCalendarEntry = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  expedition_date: '2024-03-01',
  cut_off_date: '2024-02-28',
  product_name: 'Product A',
  product_id: '550e8400-e29b-41d4-a716-446655440010',
  study_name: 'Test Study',
  study_id: '550e8400-e29b-41d4-a716-446655440020',
  planned_shipments: 10,
  confirmed_shipments: 8,
  packed_shipments: 5,
  sent_shipments: 2,
  status: 'preparing' as const,
  allocated_batches: [
    { 
      batch_id: '550e8400-e29b-41d4-a716-446655440030', 
      batch_number: 'B001', 
      units_allocated: 50,
      expiry_date: '2025-12-31',
    },
  ],
  notes: null,
};

const mockExpeditionPlan = {
  expedition_date: '2024-03-01',
  cut_off_date: '2024-02-28',
  plans: [
    { 
      product_id: '550e8400-e29b-41d4-a716-446655440010', 
      product_name: 'Product A',
      study_id: '550e8400-e29b-41d4-a716-446655440020',
      study_name: 'Test Study',
      member_count: 50,
      packages_needed: 50,
    },
  ],
};

const mockBatchAvailability = {
  product_id: '550e8400-e29b-41d4-a716-446655440010',
  requested: 50,
  available: 100,
  sufficient: true,
  shortage: 0,
  batches: [
    { 
      batch_id: '550e8400-e29b-41d4-a716-446655440030', 
      batch_number: 'B001', 
      available_units: 100,
      expiry_date: '2025-12-31',
    },
  ],
};

const mockBatchAllocationResult = {
  success: true,
  requested: 50,
  allocated: 50,
  remaining: 0,
  allocations: [
    { 
      batch_id: '550e8400-e29b-41d4-a716-446655440030', 
      batch_number: 'B001',
      quantity: 50,
      expiry_date: '2025-12-31',
      allocated_at: '2024-03-01T10:00:00Z',
    },
  ],
};

const mockBatchInventoryItem = {
  batch_id: '550e8400-e29b-41d4-a716-446655440030',
  batch_number: 'B001',
  product_id: '550e8400-e29b-41d4-a716-446655440010',
  product_name: 'Product A',
  batch_status: 'active',
  total_units: 1000,
  available_units: 800,
  assigned_units: 150,
  shipped_units: 50,
  expiry_date: '2025-12-31',
  batch_created_at: '2024-01-01T00:00:00Z',
  quality_approved: true,
};

describe('useExpedition hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.rpcMock.mockReset();
  });

  describe('useExpeditionCalendar', () => {
    it('fetches expedition calendar via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockCalendarEntry],
        error: null,
      });

      const startDate = new Date('2024-03-01');
      const endDate = new Date('2024-03-31');
      const { result } = renderHookWithProviders(() => 
        useExpeditionCalendar(startDate, endDate)
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_expedition_overview_audited', {
        p_start_date: '2024-03-01',
        p_end_date: '2024-03-31',
      });
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].planned_shipments).toBe(10);
    });

    it('handles no date filters', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockCalendarEntry],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useExpeditionCalendar());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_expedition_overview_audited', {
        p_start_date: undefined,
        p_end_date: undefined,
      });
    });

    it('generates expedition plan via mutation', async () => {
      // First call for initial fetch, second for mutation
      hoisted.rpcMock
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: mockExpeditionPlan, error: null });

      const { result, queryClient } = renderHookWithProviders(() => 
        useExpeditionCalendar()
      );
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const expeditionDate = new Date('2024-03-15');
      await act(async () => {
        await result.current.generatePlan.mutateAsync({ expeditionDate });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('generate_expedition_plan', {
        p_expedition_date: '2024-03-15',
        p_cut_off_date: undefined,
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['expedition-calendar'] });
    });

    it('generates plan with cutoff date', async () => {
      hoisted.rpcMock
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: mockExpeditionPlan, error: null });

      const { result } = renderHookWithProviders(() => useExpeditionCalendar());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const expeditionDate = new Date('2024-03-15');
      const cutOffDate = new Date('2024-03-10');
      await act(async () => {
        await result.current.generatePlan.mutateAsync({ expeditionDate, cutOffDate });
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('generate_expedition_plan', {
        p_expedition_date: '2024-03-15',
        p_cut_off_date: '2024-03-10',
      });
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const { result } = renderHookWithProviders(() => useExpeditionCalendar());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe('useBatchAvailability', () => {
    it('checks batch availability via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: mockBatchAvailability,
        error: null,
      });

      const { result } = renderHookWithProviders(() => useBatchAvailability());

      expect(result.current.availability).toBeNull();
      expect(result.current.loading).toBe(false);

      await act(async () => {
        await result.current.checkAvailability('prod-1', 50);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('check_batch_availability', {
        p_product_id: 'prod-1',
        p_quantity: 50,
      });
      expect(result.current.availability?.sufficient).toBe(true);
    });

    it('handles availability check error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Product not found' },
      });

      const { result } = renderHookWithProviders(() => useBatchAvailability());

      // The checkAvailability should throw on RPC error
      let thrownError: Error | null = null;
      try {
        await act(async () => {
          await result.current.checkAvailability('invalid-prod', 50);
        });
      } catch (e) {
        thrownError = e as Error;
      }

      // Verify the function did throw
      expect(thrownError).not.toBeNull();
    });
  });

  describe('useBatchAllocation', () => {
    it('allocates batch via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: mockBatchAllocationResult,
        error: null,
      });

      const { result, queryClient } = renderHookWithProviders(() => useBatchAllocation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const allocation = {
        shipmentId: 'ship-1',
        productId: 'prod-1',
        quantity: 50,
      };

      const allocationResult = await act(async () => {
        return await result.current.allocate(allocation);
      });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('allocate_batch_for_shipment', {
        p_shipment_id: 'ship-1',
        p_product_id: 'prod-1',
        p_quantity: 50,
      });
      expect(allocationResult.success).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shipment-records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['expedition-calendar'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['batch-inventory'] });
    });

    it('handles allocation error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Insufficient inventory' },
      });

      const { result } = renderHookWithProviders(() => useBatchAllocation());

      // The allocate should throw on RPC error
      let thrownError: Error | null = null;
      try {
        await act(async () => {
          await result.current.allocate({
            shipmentId: 'ship-1',
            productId: 'prod-1',
            quantity: 10000,
          });
        });
      } catch (e) {
        thrownError = e as Error;
      }

      // Verify the function did throw
      expect(thrownError).not.toBeNull();
    });
  });

  describe('useBatchInventory', () => {
    it('fetches batch inventory via RPC', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBatchInventoryItem],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useBatchInventory());

      await waitFor(() => {
        expect(result.current.batches).toHaveLength(1);
      }, { timeout: 5000 });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_batch_inventory_list', {
        p_product_id: undefined,
        p_status: undefined,
        p_include_empty: false,
      });
      expect(result.current.batches[0].batch_number).toBe('B001');
    });

    it('filters by product and status', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [mockBatchInventoryItem],
        error: null,
      });

      const { result } = renderHookWithProviders(() => 
        useBatchInventory('prod-1', 'active', true)
      );

      await waitFor(() => {
        expect(result.current.batches).toHaveLength(1);
      }, { timeout: 5000 });

      expect(hoisted.rpcMock).toHaveBeenCalledWith('get_batch_inventory_list', {
        p_product_id: 'prod-1',
        p_status: 'active',
        p_include_empty: true,
      });
    });

    it('returns empty array when no batches', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [],
        error: null,
      });

      const { result } = renderHookWithProviders(() => useBatchInventory());

      // Initial state is empty array
      expect(result.current.batches).toEqual([]);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      }, { timeout: 5000 });

      expect(result.current.batches).toEqual([]);
    });

    it('handles RPC error', async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: 'Access denied' },
      });

      const { result } = renderHookWithProviders(() => useBatchInventory());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      }, { timeout: 5000 });
    });
  });
});
